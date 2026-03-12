# Building a Simple Distributed Task Scheduling System

In this post, I will describe a simple, horizontally scalable distributed task scheduling system using just Go and MongoDB. For what purpose, I can't say. But it works.

System requirements:
1. **Unpredictable Workloads:** All tasks must be executed. A task can take anywhere from 2 seconds to 10 minutes.
2. **Horizontal Scaling:** The system scales simply by adding more worker nodes.
3. **Simplicity:** Adding new nodes or tasks must be straightforward.

The system has three components:

**Task Handler:**  
This acts as the controller and performs the following tasks:
- Fetches new tasks from external sources.
- Inserts them into the MongoDB with a `pending` status.
- Scans MongoDB for tasks with a `done` status and sends the results to external services.
- Scans MongoDB for tasks with a `working` status to check if they are overdue (say, 15 minutes). If they are, it resets their status to `pending`.

**Worker:**  
This component does the heavy lifting and performs the following tasks:
- Polls MongoDB for tasks with a `pending` status.
- Claims a task by atomically changing its status to `working` using MongoDB's `findOneAndUpdate`.
- Finishes the work and saves the result to the document, updating its status to `done`.

**MongoDB:**  
It's MongoDB 😏. It handles atomic operations and storage.

> AI was used to help refine and polish this article based on factual information
