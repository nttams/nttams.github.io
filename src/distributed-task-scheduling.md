# Building a Simple Distributed Task Scheduling System

When building background processing, people often use heavy tools like Kafka, RabbitMQ, or Kubernetes jobs. These tools are powerful but bring too much operation cost for simple cases.

In this post, we will explore a simple, horizontally scalable distributed task scheduling system using just Go and MongoDB.

System requirements:
1. **Unpredictable Workloads:** Tasks must be executed. A task can take varying amounts of time, from very short to quite long.
2. **Horizontal Scaling:** The system scales just by adding more worker nodes. 
3. **Simplicity:** Adding new nodes or tasks must be very simple. No complex routing.
4. **Reliability:** Every task must finish. No dropped tasks.

To achieve these goals without over-engineering, we use three components. Let's look at the design.

---

## The Architecture

The system has three components:

1. **Task Handler:** The control plane. It gets new tasks from external sources, puts them into the system, and sends final results back.
2. **Worker:** The processing unit. It does the heavy work. To get more processing power, more worker nodes are added.
3. **MongoDB:** The central state server. One MongoDB database is used to track all task states. Since tasks are independent, a simple document store is enough.

### Task Flow

When the Task Handler gets new tasks, it saves them to MongoDB with status `"pending"`. 

All Worker nodes constantly poll MongoDB for work. When a Worker finds a `"pending"` task, it claims the task by changing status to `"working"`. After finishing the work, the Worker saves the result to the document and changes status to `"done"`. 

The Task Handler periodically scans for `"done"` tasks. It takes the results, sends them to the external service, and marks tasks as archived.

This design separates task ingestion from task execution.

---

## Challenge 1: Prevent Duplicated Work 

When many worker nodes poll the same database, race conditions happen. If two workers query a pending task at the same time, they might grab the same task. This causes duplicated work and wastes resources.

To prevent this, workers must claim tasks atomically. In MongoDB, the `findOneAndUpdate` operation is used.

### Atomic Claim

`find()` then `update()` are not used. They are combined into one atomic database query. The worker searches for a document where `status == "pending"` and sets it to `"working"` in the same step. MongoDB ensures only one worker can modify and receive the document.

Here is a pseudocode showing how a worker claims a task:

```go
func ClaimNextTask(ctx context.Context, db *mongo.Database) (*Task, error) {
    collection := db.Collection("tasks")
    
    // Filter for pending task
    filter := bson.M{"status": "pending"}
    
    // Atomically set status to "working" and record worker ID
    update := bson.M{
        "$set": bson.M{
            "status": "working",
            "worker_id": getLocalNodeID(),
            "started_at": time.Now(),
        },
    }
    
    // Return updated document
    opts := options.FindOneAndUpdate().SetReturnDocument(options.After)
    
    var task Task
    err := collection.FindOneAndUpdate(ctx, filter, update, opts).Decode(&task)
    if err != nil {
        if err == mongo.ErrNoDocuments {
            return nil, nil // No task available
        }
        return nil, err
    }
    
    return &task, nil
}
```

After a worker claims a task, it owns the task. It can take 2 seconds or 10 minutes. No other worker will touch it because the status is not `"pending"`.

#### Performance Tuning: Polling Backoff
Since workers constantly poll the database, we should avoid high load when the queue is empty. We can use an exponential backoff in the worker loop. If a worker finds no `"pending"` tasks, it sleeps for a short duration that increases exponentially. When it finds a task, the sleep time resets to zero.

Also, create a compound index `{ status: 1, created_at: 1 }` in MongoDB to make polling fast.

---

## Challenge 2: Manage Concurrency

Tasks have different execution times and can use high CPU or memory. 

Because of this, a strict rule is set: **Each worker node runs only one task at a time.** 

Instead of building a complex thread pool in the worker application, infrastructure scaling is relied upon. The worker runs linearly. It polls a task, runs it, finishes it, and polls the next one. 

This keeps the worker logic very simple:

```go
func RunWorkerLoop() {
    for {
        task, _ := ClaimNextTask(ctx, db)
        if task == nil {
            time.Sleep(2 * time.Second) // backoff
            continue
        }
        
        // Run heavy task
        result := executeHeavyWorkload(task.Payload)
        
        // Mark task as done
        SubmitTaskResult(task.ID, result)
    }
}

func SubmitTaskResult(taskID string, result interface{}) {
    // Update MongoDB status to 'done' and save result
}
```

If the task queue is long, more worker containers are started. The database handles atomic locking, so adding nodes increases throughput easily with zero configuration.

---

## Challenge 3: Return Results Safely

The last step is sending data back to the external world. 

Workers are not allowed to talk to the external service. If a worker fails to send the result due to network issues, the worker will be blocked by retries and waste time.

Workers only talk to MongoDB. They change task status to `"done"` and move to the next task.

The **Task Handler** manages delivery. It runs a background scanner that queries MongoDB for `"done"` tasks. 

```go
func ScannerLoop() {
    for {
        // Find finished tasks
        doneTasks := findTasksByStatus("done")
        
        for _, task := range doneTasks {
            // Send to external API
            success := externalService.SubmitResult(task.Result)
            
            if success {
                // Archive task
                markTaskArchived(task.ID)
            }
        }
        
        time.Sleep(30 * time.Second)
    }
}
```

By separating Task Handler, it can handle retries and network errors with the external service without blocking worker nodes.

#### Performance Tuning: Zombie Tasks
If a worker claims a task, marks it as `"working"`, and then crashes, the task stays in the `"working"` state forever.

To ensure all tasks finish, the Task Handler needs a timeout check. When a worker claims a task, it sets `started_at`. The Task Handler periodically scans for `"working"` tasks older than a maximum duration limit (e.g., 15 minutes). If it finds one, it assumes the worker failed and changes status to `"pending"` so another worker can run it.

---

## Summary

Distributed systems do not always need complex tools like Kafka. By understanding limits, a stable task scheduler can be built using basic database features.

Key takeaways:
1. **Use Atomic Database Operations:** We can build safe queues using MongoDB `findOneAndUpdate`. It prevents race conditions.
2. **Scale by Infrastructure:** Limiting workers to one task makes code simple. To get more power, add more nodes.
3. **Isolate Processing from I/O:** Workers do heavy computing and talk to database. Task Handler manages external APIs and retries. This keeps workers fast and unblocked.

Using atomic database updates and a simple worker loop gives us horizontal scaling with very low operation cost.

> AI was used to help refine and polish this article based on factual information
