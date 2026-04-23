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

---

<div style="display:flex;flex-direction:column;align-items:center;font-family:system-ui,sans-serif;margin:32px 0;gap:0;">

  <!-- External Service -->
  <div style="background:#f5f5f5;border:1.5px solid #c0c0c0;border-radius:6px;padding:9px 28px;text-align:center;font-size:13px;color:#2d2d2d;min-width:160px;">External Service</div>

  <!-- Two separate arrows -->
  <div style="display:flex;gap:24px;align-items:center;margin:4px 0;">
    <div style="display:flex;flex-direction:column;align-items:center;gap:2px;">
      <svg width="14" height="20" viewBox="0 0 14 20"><line x1="7" y1="0" x2="7" y2="13" stroke="#c0c0c0" stroke-width="1.5"/><polygon points="7,20 2,12 12,12" fill="#c0c0c0"/></svg>
      <div style="font-size:11px;color:#888;">new tasks</div>
    </div>
    <div style="display:flex;flex-direction:column;align-items:center;gap:2px;">
      <div style="font-size:11px;color:#888;">results</div>
      <svg width="14" height="20" viewBox="0 0 14 20"><line x1="7" y1="7" x2="7" y2="20" stroke="#c0c0c0" stroke-width="1.5"/><polygon points="7,0 2,8 12,8" fill="#c0c0c0"/></svg>
    </div>
  </div>

  <!-- Task Handler -->
  <div style="background:#e8e8e8;border:1.5px solid #aaa;border-radius:6px;padding:9px 28px;text-align:center;font-size:13px;color:#2d2d2d;min-width:160px;">Task Handler</div>

  <!-- Two separate arrows: Task Handler <-> MongoDB -->
  <div style="display:flex;gap:24px;align-items:center;margin:4px 0;">
    <div style="display:flex;flex-direction:column;align-items:center;gap:2px;">
      <svg width="14" height="20" viewBox="0 0 14 20"><line x1="7" y1="0" x2="7" y2="13" stroke="#c0c0c0" stroke-width="1.5"/><polygon points="7,20 2,12 12,12" fill="#c0c0c0"/></svg>
      <div style="font-size:11px;color:#888;">insert pending / reset overdue</div>
    </div>
    <div style="display:flex;flex-direction:column;align-items:center;gap:2px;">
      <div style="font-size:11px;color:#888;">read done</div>
      <svg width="14" height="20" viewBox="0 0 14 20"><line x1="7" y1="7" x2="7" y2="20" stroke="#c0c0c0" stroke-width="1.5"/><polygon points="7,0 2,8 12,8" fill="#c0c0c0"/></svg>
    </div>
  </div>

  <!-- MongoDB (center) -->
  <div style="background:#e8e8e8;border:1.5px solid #aaa;border-radius:6px;padding:9px 28px;text-align:center;font-size:13px;color:#2d2d2d;min-width:160px;">MongoDB</div>

  <!-- Two separate arrows: MongoDB <-> Workers -->
  <div style="display:flex;gap:24px;align-items:center;margin:4px 0;">
    <div style="display:flex;flex-direction:column;align-items:center;gap:2px;">
      <svg width="14" height="20" viewBox="0 0 14 20"><line x1="7" y1="0" x2="7" y2="13" stroke="#c0c0c0" stroke-width="1.5"/><polygon points="7,20 2,12 12,12" fill="#c0c0c0"/></svg>
      <div style="font-size:11px;color:#888;">poll &amp; claim pending</div>
    </div>
    <div style="display:flex;flex-direction:column;align-items:center;gap:2px;">
      <div style="font-size:11px;color:#888;">save done</div>
      <svg width="14" height="20" viewBox="0 0 14 20"><line x1="7" y1="7" x2="7" y2="20" stroke="#c0c0c0" stroke-width="1.5"/><polygon points="7,0 2,8 12,8" fill="#c0c0c0"/></svg>
    </div>
  </div>

  <!-- Workers grouped in a box -->
  <div style="border:1.5px solid #c0c0c0;border-radius:8px;padding:12px 20px;">
    <div style="font-size:11px;color:#888;text-align:center;margin-bottom:8px;text-transform:uppercase;letter-spacing:0.05em;">Workers</div>
    <div style="display:flex;gap:12px;align-items:stretch;">
      <div style="background:#f5f5f5;border:1.5px solid #c0c0c0;border-radius:6px;padding:9px 20px;text-align:center;font-size:13px;color:#2d2d2d;">Worker 1</div>
      <div style="background:#f5f5f5;border:1.5px solid #c0c0c0;border-radius:6px;padding:9px 20px;text-align:center;font-size:13px;color:#2d2d2d;">Worker 2</div>
      <div style="background:#f5f5f5;border:1.5px dashed #c0c0c0;border-radius:6px;padding:9px 20px;text-align:center;font-size:13px;color:#aaa;">Worker N</div>
    </div>
  </div>

</div>

