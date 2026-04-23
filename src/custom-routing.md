# Custom Routing

> **Disclaimer:** All numbers and examples in this article describe abstract ideas. They are not exact facts about any real system.

A RTB system handles 10,000 active campaigns, is horizontally scalable, we can add more compute nodes to handle more load. But scaling campaign capacity revealed a real problem: the more we scaled, the worse our match rate got.

## The Problem: Campaigns Are Spread Thin

Matching a bid request to a campaign is CPU-heavy. For each incoming bid request, a node must check eligibility across every campaign: targeting rules, budget limits, frequency caps, and more. A single node cannot handle 10,000 campaigns at full traffic, so we distribute campaigns across nodes.

Each campaign is distributed across 3 of the 10 nodes (to increase visibility). That means each node holds about 3,000 campaigns:

```text
Total campaigns: 10,000
Nodes: 10
Replicas per campaign: 3
Campaigns per node: 10,000 × 3 / 10 = 3,000
```

Incoming bid requests are routed to one node. That node only "sees" its 3,000 campaigns. If the right campaign for this request lives on one of the other 7 nodes, we waste that request

As we added more nodes to scale capacity, campaigns were spread even thinner across them. The match rate got worse. This is a fundamental issue with round-robin routing. The load balancer distributes requests evenly across nodes with no awareness of which campaigns each node holds, so no node has visibility of all campaigns

<div style="display:flex;flex-direction:column;align-items:center;font-family:system-ui,sans-serif;margin:24px 0;">
  <div style="background:#f5f5f5;border:1.5px solid #c0c0c0;border-radius:6px;padding:9px 20px;text-align:center;font-size:13px;color:#2d2d2d;">Bid Request</div>
  <div style="display:flex;justify-content:center;margin:3px 0;"><svg width="14" height="20" viewBox="0 0 14 20"><line x1="7" y1="0" x2="7" y2="13" stroke="#c0c0c0" stroke-width="1.5"/><polygon points="7,20 2,12 12,12" fill="#c0c0c0"/></svg></div>
  <div style="background:#f5f5f5;border:1.5px solid #c0c0c0;border-radius:6px;padding:9px 20px;text-align:center;font-size:13px;color:#2d2d2d;">Load Balancer<span style="display:block;font-size:11px;color:#888;margin-top:2px;">round-robin routing</span></div>
  <div style="display:flex;justify-content:center;margin:3px 0;"><svg width="14" height="20" viewBox="0 0 14 20"><line x1="7" y1="0" x2="7" y2="13" stroke="#c0c0c0" stroke-width="1.5"/><polygon points="7,20 2,12 12,12" fill="#c0c0c0"/></svg></div>
  <div style="border:1.5px solid #c0c0c0;border-radius:8px;padding:12px 20px;">
    <div style="font-size:11px;color:#888;text-align:center;margin-bottom:8px;text-transform:uppercase;letter-spacing:0.05em;">Compute Nodes</div>
    <div style="display:flex;gap:8px;align-items:center;">
      <div style="background:#f5f5f5;border:1.5px solid #c0c0c0;border-radius:6px;padding:9px 14px;text-align:center;font-size:13px;color:#2d2d2d;">Node 1<span style="display:block;font-size:11px;color:#888;margin-top:2px;">3,000 camps</span></div>
      <div style="background:#f5f5f5;border:1.5px solid #c0c0c0;border-radius:6px;padding:9px 14px;text-align:center;font-size:13px;color:#2d2d2d;">Node 2<span style="display:block;font-size:11px;color:#888;margin-top:2px;">3,000 camps</span></div>
      <div style="color:#c0c0c0;font-size:18px;padding:0 4px;">···</div>
      <div style="background:#f5f5f5;border:1.5px dashed #c0c0c0;border-radius:6px;padding:9px 14px;text-align:center;font-size:13px;color:#aaa;">Node 10<span style="display:block;font-size:11px;margin-top:2px;">3,000 camps</span></div>
    </div>
  </div>
</div>



## The Solution: A Custom Reverse Proxy

We built a reverse proxy that sits in front of the compute nodes. Instead of round-robin routing, it routes each bid request to the node most likely to have a matching campaign. The proxy does not run the full filtering logic, that is too CPU-heavy. Instead, it applies a small number of fast, lightweight filter, the goal is to remove clearly wrong nodes and increase the probability that a bid request lands on a node with a matching campaign

<div style="display:flex;flex-direction:column;align-items:center;font-family:system-ui,sans-serif;margin:24px 0;">
  <div style="background:#f5f5f5;border:1.5px solid #c0c0c0;border-radius:6px;padding:9px 20px;text-align:center;font-size:13px;color:#2d2d2d;">Bid Request</div>
  <div style="display:flex;justify-content:center;margin:3px 0;"><svg width="14" height="20" viewBox="0 0 14 20"><line x1="7" y1="0" x2="7" y2="13" stroke="#c0c0c0" stroke-width="1.5"/><polygon points="7,20 2,12 12,12" fill="#c0c0c0"/></svg></div>
  <div style="background:#f5f5f5;border:1.5px solid #c0c0c0;border-radius:6px;padding:9px 20px;text-align:center;font-size:13px;color:#2d2d2d;">Load Balancer</div>
  <div style="display:flex;justify-content:center;margin:3px 0;"><svg width="14" height="20" viewBox="0 0 14 20"><line x1="7" y1="0" x2="7" y2="13" stroke="#c0c0c0" stroke-width="1.5"/><polygon points="7,20 2,12 12,12" fill="#c0c0c0"/></svg></div>
  <div style="border:1px solid #d8d8d8;border-radius:8px;padding:16px 20px;">
    <div style="font-size:11px;color:#888;text-align:center;margin-bottom:12px;text-transform:uppercase;letter-spacing:0.05em;">Lightweight Routing Layer</div>
    <div style="display:flex;gap:16px;align-items:center;">
      <div style="border:1.5px solid #c0c0c0;border-radius:8px;padding:12px 20px;">
        <div style="font-size:11px;color:#888;text-align:center;margin-bottom:8px;text-transform:uppercase;letter-spacing:0.05em;">Reverse Proxy (Go)</div>
        <div style="display:flex;gap:8px;align-items:center;">
          <div style="background:#f5f5f5;border:1.5px solid #c0c0c0;border-radius:6px;padding:9px 14px;text-align:center;font-size:13px;color:#2d2d2d;">Proxy 1<span style="display:block;font-size:11px;color:#888;margin-top:2px;">lightweight filter</span></div>
          <div style="background:#f5f5f5;border:1.5px solid #c0c0c0;border-radius:6px;padding:9px 14px;text-align:center;font-size:13px;color:#2d2d2d;">Proxy 2<span style="display:block;font-size:11px;color:#888;margin-top:2px;">lightweight filter</span></div>
          <div style="color:#c0c0c0;font-size:18px;padding:0 4px;">···</div>
          <div style="background:#f5f5f5;border:1.5px dashed #c0c0c0;border-radius:6px;padding:9px 14px;text-align:center;font-size:13px;color:#aaa;">Proxy N<span style="display:block;font-size:11px;margin-top:2px;">lightweight filter</span></div>
        </div>
      </div>
      <div style="display:flex;flex-direction:column;align-items:center;gap:4px;">
        <div style="display:flex;align-items:center;gap:4px;">
          <div style="font-size:11px;color:#888;">query</div>
          <svg width="20" height="14" viewBox="0 0 20 14"><line x1="0" y1="7" x2="13" y2="7" stroke="#c0c0c0" stroke-width="1.5"/><polygon points="20,7 12,2 12,12" fill="#c0c0c0"/></svg>
        </div>
        <div style="display:flex;align-items:center;gap:4px;">
          <svg width="20" height="14" viewBox="0 0 20 14"><line x1="20" y1="7" x2="7" y2="7" stroke="#c0c0c0" stroke-width="1.5"/><polygon points="0,7 8,2 8,12" fill="#c0c0c0"/></svg>
          <div style="font-size:11px;color:#888;">result</div>
        </div>
      </div>
      <div style="background:#f5f5f5;border:1.5px solid #c0c0c0;border-radius:6px;padding:9px 20px;text-align:center;font-size:13px;color:#2d2d2d;">Redis<span style="display:block;font-size:11px;color:#888;margin-top:2px;">routing data</span></div>
    </div>
  </div>
  <div style="display:flex;justify-content:center;margin:3px 0;"><svg width="14" height="20" viewBox="0 0 14 20"><line x1="7" y1="0" x2="7" y2="13" stroke="#c0c0c0" stroke-width="1.5"/><polygon points="7,20 2,12 12,12" fill="#c0c0c0"/></svg></div>
  <div style="border:1.5px solid #555;border-radius:8px;padding:12px 20px;background:#f0f0f0;">
    <div style="font-size:11px;color:#555;text-align:center;margin-bottom:8px;text-transform:uppercase;letter-spacing:0.05em;font-weight:600;">Heavy Compute Layer</div>
    <div style="display:flex;gap:8px;align-items:center;">
      <div style="background:#ddd;border:1.5px solid #888;border-radius:6px;padding:9px 14px;text-align:center;font-size:13px;color:#2d2d2d;">Node 1<span style="display:block;font-size:11px;color:#666;margin-top:2px;">3,000 camps</span></div>
      <div style="background:#ddd;border:1.5px solid #888;border-radius:6px;padding:9px 14px;text-align:center;font-size:13px;color:#2d2d2d;">Node 2<span style="display:block;font-size:11px;color:#666;margin-top:2px;">3,000 camps</span></div>
      <div style="color:#888;font-size:18px;padding:0 4px;">···</div>
      <div style="background:#ddd;border:1.5px dashed #888;border-radius:6px;padding:9px 14px;text-align:center;font-size:13px;color:#888;">Node 10<span style="display:block;font-size:11px;margin-top:2px;">3,000 camps</span></div>
    </div>
  </div>
</div>

We built this in Go using the standard `net/http/httputil.ReverseProxy` package with custom routing logic, pre-computed routing data is stored in Redis. We store this data in Redis instead of Go's memory, because keeping millions of entries in a `map[string]string` inside a Go process puts heavy pressure on the garbage collector. Go's GC must scan every pointer in the map on every cycle, which causes periodic CPU spikes. Moving the data to Redis removes it from Go's heap entirely. We covered this issue in detail in [Large Maps Are Bad for Go GC](./large-maps-are-bad-for-go-gc.md), which we discovered while building this proxy.

## How the Routing Works

When a bid request arrives at the proxy:

1. Read key attributes from the request (e.g. userID)
2. For each compute node, check Redis to see if that node has any active campaigns that match those attributes
3. Route the request to the node with the highest number of potential matches

We only apply fast filter checks, the ones with high selectivity and low compute cost. The full filtering still happens on the compute node

<div style="display:flex;flex-direction:column;align-items:center;font-family:system-ui,sans-serif;margin:24px 0;">
  <div style="background:#f5f5f5;border:1.5px solid #c0c0c0;border-radius:6px;padding:9px 20px;text-align:center;font-size:13px;color:#2d2d2d;min-width:220px;">Bid Request</div>
  <div style="display:flex;justify-content:center;margin:3px 0;"><svg width="14" height="20" viewBox="0 0 14 20"><line x1="7" y1="0" x2="7" y2="13" stroke="#c0c0c0" stroke-width="1.5"/><polygon points="7,20 2,12 12,12" fill="#c0c0c0"/></svg></div>
  <div style="background:#f5f5f5;border:1.5px solid #c0c0c0;border-radius:6px;padding:9px 20px;text-align:center;font-size:13px;color:#2d2d2d;min-width:220px;">Parse Request<span style="display:block;font-size:11px;color:#888;margin-top:2px;">userID, ...</span></div>
  <div style="display:flex;justify-content:center;margin:3px 0;"><svg width="14" height="20" viewBox="0 0 14 20"><line x1="7" y1="0" x2="7" y2="13" stroke="#c0c0c0" stroke-width="1.5"/><polygon points="7,20 2,12 12,12" fill="#c0c0c0"/></svg></div>
  <div style="background:#f5f5f5;border:1.5px solid #c0c0c0;border-radius:6px;padding:9px 20px;text-align:center;font-size:13px;color:#2d2d2d;min-width:220px;">Query Redis<span style="display:block;font-size:11px;color:#888;margin-top:2px;">which nodes have matching campaigns?</span></div>
  <div style="display:flex;justify-content:center;margin:3px 0;"><svg width="14" height="20" viewBox="0 0 14 20"><line x1="7" y1="0" x2="7" y2="13" stroke="#c0c0c0" stroke-width="1.5"/><polygon points="7,20 2,12 12,12" fill="#c0c0c0"/></svg></div>
  <div style="background:#f5f5f5;border:1.5px solid #c0c0c0;border-radius:6px;padding:9px 20px;text-align:center;font-size:13px;color:#2d2d2d;min-width:220px;">Pick Best Node<span style="display:block;font-size:11px;color:#888;margin-top:2px;">highest match potential</span></div>
  <div style="display:flex;justify-content:center;margin:3px 0;"><svg width="14" height="20" viewBox="0 0 14 20"><line x1="7" y1="0" x2="7" y2="13" stroke="#c0c0c0" stroke-width="1.5"/><polygon points="7,20 2,12 12,12" fill="#c0c0c0"/></svg></div>
  <div style="background:#f5f5f5;border:1.5px solid #c0c0c0;border-radius:6px;padding:9px 20px;text-align:center;font-size:13px;color:#2d2d2d;min-width:220px;">Forward to Node</div>
</div>

## Upstream Health Checks

At first, we only checked whether upstream nodes were alive. If a node stopped responding to health checks, we removed it from the routing pool. Then we found that when a node crashes and restarts, it comes back online healthy but has no active campaigns yet because it has not finished loading its campaign data. This becomes a problem when the proxy uses least request routing. An empty node responds to requests very fast because it has nothing to check, so it always appears to have the fewest in-flight requests. The proxy keeps sending it more traffic, which all result in no bid

We then exposed an API endpoint that returns its current active campaign count, the proxy checks this count. If it is zero (or below a minimum threshold), the node is skipped from the routing pool until it is ready

<div style="display:flex;flex-direction:column;align-items:center;font-family:system-ui,sans-serif;margin:24px 0;">
  <div style="background:#f5f5f5;border:1.5px solid #c0c0c0;border-radius:6px;padding:9px 20px;text-align:center;font-size:13px;color:#2d2d2d;">Health Check (per node)</div>
  <div style="display:flex;justify-content:center;margin:3px 0;"><svg width="14" height="20" viewBox="0 0 14 20"><line x1="7" y1="0" x2="7" y2="13" stroke="#c0c0c0" stroke-width="1.5"/><polygon points="7,20 2,12 12,12" fill="#c0c0c0"/></svg></div>
  <div style="background:#e8e8e8;border:1.5px solid #aaa;border-radius:6px;padding:9px 20px;text-align:center;font-size:13px;color:#2d2d2d;">Is node alive?</div>
  <div style="display:flex;justify-content:center;"><svg width="14" height="8" viewBox="0 0 14 8"><line x1="7" y1="0" x2="7" y2="8" stroke="#c0c0c0" stroke-width="1.5"/></svg></div>
  <div style="display:flex;gap:48px;align-items:flex-start;border-top:1.5px solid #c0c0c0;padding-top:8px;">
    <div style="display:flex;flex-direction:column;align-items:center;">
      <div style="font-size:11px;color:#888;margin-bottom:3px;">No</div>
      <div style="display:flex;justify-content:center;margin:2px 0;"><svg width="14" height="16" viewBox="0 0 14 16"><line x1="7" y1="0" x2="7" y2="9" stroke="#c0c0c0" stroke-width="1.5"/><polygon points="7,16 2,8 12,8" fill="#c0c0c0"/></svg></div>
      <div style="background:#f5f5f5;border:1.5px solid #c0c0c0;border-radius:6px;padding:9px 14px;text-align:center;font-size:13px;color:#2d2d2d;">Remove from pool</div>
    </div>
    <div style="display:flex;flex-direction:column;align-items:center;">
      <div style="font-size:11px;color:#888;margin-bottom:3px;">Yes</div>
      <div style="display:flex;justify-content:center;margin:2px 0;"><svg width="14" height="16" viewBox="0 0 14 16"><line x1="7" y1="0" x2="7" y2="9" stroke="#c0c0c0" stroke-width="1.5"/><polygon points="7,16 2,8 12,8" fill="#c0c0c0"/></svg></div>
      <div style="background:#e8e8e8;border:1.5px solid #aaa;border-radius:6px;padding:9px 14px;text-align:center;font-size:13px;color:#2d2d2d;">Has campaigns?</div>
      <div style="display:flex;justify-content:center;"><svg width="14" height="8" viewBox="0 0 14 8"><line x1="7" y1="0" x2="7" y2="8" stroke="#c0c0c0" stroke-width="1.5"/></svg></div>
      <div style="display:flex;gap:32px;align-items:flex-start;border-top:1.5px solid #c0c0c0;padding-top:8px;">
        <div style="display:flex;flex-direction:column;align-items:center;">
          <div style="font-size:11px;color:#888;margin-bottom:3px;">No</div>
          <div style="display:flex;justify-content:center;margin:2px 0;"><svg width="14" height="16" viewBox="0 0 14 16"><line x1="7" y1="0" x2="7" y2="9" stroke="#c0c0c0" stroke-width="1.5"/><polygon points="7,16 2,8 12,8" fill="#c0c0c0"/></svg></div>
          <div style="background:#f5f5f5;border:1.5px solid #c0c0c0;border-radius:6px;padding:9px 14px;text-align:center;font-size:13px;color:#2d2d2d;">Remove from pool</div>
        </div>
        <div style="display:flex;flex-direction:column;align-items:center;">
          <div style="font-size:11px;color:#888;margin-bottom:3px;">Yes</div>
          <div style="display:flex;justify-content:center;margin:2px 0;"><svg width="14" height="16" viewBox="0 0 14 16"><line x1="7" y1="0" x2="7" y2="9" stroke="#c0c0c0" stroke-width="1.5"/><polygon points="7,16 2,8 12,8" fill="#c0c0c0"/></svg></div>
          <div style="background:#f5f5f5;border:1.5px solid #c0c0c0;border-radius:6px;padding:9px 14px;text-align:center;font-size:13px;color:#2d2d2d;">Include in pool</div>
        </div>
      </div>
    </div>
  </div>
</div>

## Results and Trade-offs

After deploying the custom routing proxy, our match rate increased by around **30%**. The trade-off is added latency. The proxy needs to query Redis and run routing logic before forwarding. This adds around **5ms** to each request, which is acceptable in our systems


## Key Takeaways

1. **Do lightweight filtering at the proxy layer.** Running full filtering at the proxy is too expensive. A few fast checks are enough to make better routing decisions
2. **Healthy does not mean ready.** A node that just restarted can appear healthy but have no data. Check application-level readiness, not just network-level liveness
