# Building a Dead-Simple Distributed Task Scheduling System
2026-03-08

\* *AI was used to help refine and polish this article based on factual information* \*

When building background processing pipelines, we often reach for heavy industry standards like Kafka, RabbitMQ, or complex Kubernetes job orchestrators. While these tools are incredibly powerful, they sometimes bring too much operational overhead for simpler use cases. 

In this post, I will share how we built a wildly simple, horizontally scalable distributed task scheduling system using just Go and MongoDB.

The requirements for our system were straightforward but strict:
1. **Unpredictable Workloads:** We have a list of standalone tasks that need to be executed. The catch? A task can take anywhere from 2 seconds to 10 minutes to finish. 
2. **Horizontal Scaling:** We need to scale the system horizontally strictly by adding more processing nodes. 
3. **Simplicity:** The process to add new nodes or submit new tasks must be super simple. No complex routing or partition keys.
4. **Reliability:** Every single task must be finished. No dropped tasks.

To hit these goals without over-engineering, we designed a system with exactly three components. Let's break down how we approached this.

---

## The Architecture

Our distributed scheduling system relies on three distinct components:

1. **The Task Handler:** This is the control plane. It fetches new tasks from an external source, seeds them into our system, and ultimately submits the final results back to the external world.
2. **The Worker:** This is the muscle. The worker actually does the heavy lifting. If we need more processing power, we just spin up more worker nodes.
3. **MongoDB:** The centralized brain. We use a single MongoDB database to track the state of every task. Because tasks are completely independent, a simple document store is perfect for keeping things coordinated.

### The Task Flow at a Glance

When the Task Handler discovers new tasks, it writes them into MongoDB as documents with their status set to `"pending"`. 

Meanwhile, all of our Worker nodes are constantly polling MongoDB looking for work. When a Worker finds a `"pending"` task, it claims the task by updating the status to `"working"`. Once the heavy lifting is complete, the Worker writes the result back to the document and updates the status to `"done"`. 

Finally, the Task Handler periodically scans the database for `"done"` tasks. When it finds them, it takes the results, submits them back to the external service, and marks the task as archived.

This setup isolates the ingestion of tasks from the execution of tasks.

---

## Challenge 1: Preventing Duplicated Work 

When you have twenty worker nodes polling the exact same database for pending tasks, you run into an immediate race condition. If two workers query for a pending task at the same millisecond, they might both grab the same task. This leads to duplicated work, which ruins the efficiency of a distributed system.

To prevent this, workers must claim tasks *atomically*. In MongoDB, we achieve this using the `findOneAndUpdate` operation.

### Atomic Claiming

Instead of doing a `find()` followed by an `update()`, we combine them into a single, atomic database query. The worker searches for a document where `status == "pending"`, and in the exact same operation, sets it to `"working"`. MongoDB guarantees that only one worker will successfully modify and receive the document.

Here is a quick pseudocode snippet showing how the worker claims a task:

```go
func ClaimNextTask(ctx context.Context, db *mongo.Database) (*Task, error) {
    collection := db.Collection("tasks")
    
    // Filter for any pending task
    filter := bson.M{"status": "pending"}
    
    // Atomically set the status to "working" and record which node claimed it
    update := bson.M{
        "$set": bson.M{
            "status": "working",
            "worker_id": getLocalNodeID(),
            "started_at": time.Now(),
        },
    }
    
    // Return the updated document
    opts := options.FindOneAndUpdate().SetReturnDocument(options.After)
    
    var task Task
    err := collection.FindOneAndUpdate(ctx, filter, update, opts).Decode(&task)
    if err != nil {
        if err == mongo.ErrNoDocuments {
            return nil, nil // No tasks available right now
        }
        return nil, err
    }
    
    return &task, nil
}
```

Once a worker atomically claims a task, it owns it. It can take 2 seconds or 10 minutes to process. No other worker will ever touch it because the status is no longer `"pending"`.

#### Performance Tuning Insights: Polling Backoff
Since workers constantly poll the database, you want to avoid thrashing MongoDB when the queue is empty. Implementing an exponential backoff in your worker loop prevents unnecessary database load. If a worker finds no `"pending"` tasks, it should sleep for 1 second, then 2 seconds, then 4 seconds (up to a cap) before polling again. As soon as it finds a task, the sleep timer resets to zero.

Additionally, ensure you have a compound index in MongoDB on `{ status: 1, created_at: 1 }` so the database can aggressively optimize the polling queries.

---

## Challenge 2: Managing Concurrency on Workers

One of our core requirements is that tasks can be highly variable in duration (up to 10 minutes). They might also be CPU-intensive or memory-heavy. 

Because of this variability, we enforced a strict rule for horizontal scaling: **Each worker node only runs one task at a time.** 

Instead of building a complex thread pool inside the worker application to run multiple tasks, we rely on infrastructure to scale. The worker binary is designed to be single-threaded at the task level. It polls a task, executes it, finishes it, and then polls the next one. 

This makes the worker logic incredibly simple:

```go
func RunWorkerLoop() {
    for {
        task, _ := ClaimNextTask(ctx, db)
        if task == nil {
            time.Sleep(2 * time.Second) // backoff
            continue
        }
        
        // Execute the heavy task synchronously
        // Note: The task itself might spawn goroutines for internal parallelization,
        // but the worker orchestrator waits for it to finish.
        result := executeHeavyWorkload(task.Payload)
        
        // Mark task as done
        SubmitTaskResult(task.ID, result)
    }
}

func SubmitTaskResult(taskID string, result interface{}) {
    // Update MongoDB status to 'done' and save the result
}
```

If we notice that our task queue is growing too large, we do not tune concurrency settings in a config file. We simply spin up 10, 20, or 100 more Docker containers running the worker image. Because the database handles the atomic locking, adding nodes instantly increases throughput with exactly zero configuration.

*(Note: While a worker only processes one task pipeline at a time, the task execution logic itself is allowed to use parallel processing (like goroutines) internally to speed up its specific workload. The worker simply acts as a synchronous wrapper around the job.)*

---

## Challenge 3: Closing the Loop Safely

The final piece of the puzzle is getting the finished data back to the external world. 

We deliberately do not let the workers talk to the external service. If a worker fails to send the final result due to an external network blip, we would have heavily processed data sitting in limbo, and the worker would be tied up attempting retries.

Instead, the workers only talk to MongoDB. They flip the task status to `"done"` and immediately move on to the next pending task.

The **Task Handler** (our control plane) takes on the responsibility of delivery. It runs a periodic background scanner that queries MongoDB for `"done"` tasks. 

```go
func ScannerLoop() {
    for {
        // Find all finished tasks
        doneTasks := findTasksByStatus("done")
        
        for _, task := range doneTasks {
            // Send back to external API
            success := externalService.SubmitResult(task.Result)
            
            if success {
                // Permanently archive or delete the task
                markTaskArchived(task.ID)
            }
        }
        
        time.Sleep(30 * time.Second)
    }
}
```

Because the Task Handler is separate, it can implement aggressive retry logic, exponential backoffs, and circuit breakers against the external service, all without blocking the worker nodes from churning through the heavy processing queue.

#### Performance Tuning Insights: Zombie Tasks
What happens if a worker claims a task, marks it as `"working"`, and then the worker node crashes or loses power? That task will sit in the `"working"` state forever.

To guarantee all tasks are finished, the Task Handler needs a "zombifier" routine. When a worker claims a task, it records a `started_at` timestamp. The Task Handler periodically scans for tasks where `status == "working"` but the `started_at` is older than our maximum known execution time (e.g., 15 minutes). If it finds one, it assumes the worker died, and flips the status back to `"pending"` so another healthy worker can pick it up.

---

## Conclusion

Distributed systems do not always require a massive event-driven messaging platform like Kafka. By deeply understanding our constraints, we built a highly resilient task scheduler using basic database functionality.

To summarize the engineering takeaways:
1. **Rely on Atomic Database Operations:** You can safely build distributed locking and queueing using MongoDB's `findOneAndUpdate`. It perfectly prevents race conditions between competing nodes.
2. **Scale by Infrastructure, Not Complexity:** By limiting workers to one task at a time, we removed complex internal concurrency management. If we need more throughput, we just add more nodes. The process is completely frictionless.
3. **Isolate I/O from Processing:** Workers do heavy local computing and talk cleanly to the database. The Task Handler deals with external APIs and retries. This separation of concerns keeps the critical hot path of processing unblocked.

By combining atomic database updates with a dead-simple worker loop, we achieved infinite horizontal scaling with practically zero operational overhead.
