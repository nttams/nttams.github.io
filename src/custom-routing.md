# Custom Routing

> **Disclaimer:** All numbers and examples in this article describe abstract ideas. They are not exact facts about any real system.

A RTB system handles 10,000 active campaigns, is horizontally scalable, we can add more compute nodes to handle more load. But scaling campaign capacity revealed a real problem: the more we scaled, the worse our match rate got.

## The Problem: Campaigns Are Spread Thin

Matching a bid request to a campaign is CPU-heavy. For each incoming bid request, a node must check eligibility across every campaign: targeting rules, budget limits, frequency caps, and more. A single node cannot handle 10,000 campaigns at full traffic, so we distribute campaigns across nodes.

Each node only holds a subset of campaigns, around 1,000. That means at any moment:

```text
Total campaigns: 10,000
Nodes: 10
Campaigns per node: ~1,000
```

Incoming bid requests are routed to one node. That node only "sees" its 1,000 campaigns. If the right campaign for this request lives on a different node, we miss the match entirely.

As we added more nodes to scale capacity, campaigns were spread even thinner across them. The match rate did not improve, it got worse.

<div style="display:flex;flex-direction:column;align-items:center;font-family:system-ui,sans-serif;margin:24px 0;">
  <div style="background:#f5f5f5;border:1.5px solid #c0c0c0;border-radius:6px;padding:9px 20px;text-align:center;font-size:13px;color:#2d2d2d;">Bid Request</div>
  <div style="display:flex;justify-content:center;margin:3px 0;"><svg width="14" height="20" viewBox="0 0 14 20"><line x1="7" y1="0" x2="7" y2="13" stroke="#c0c0c0" stroke-width="1.5"/><polygon points="7,20 2,12 12,12" fill="#c0c0c0"/></svg></div>
  <div style="background:#f5f5f5;border:1.5px solid #c0c0c0;border-radius:6px;padding:9px 20px;text-align:center;font-size:13px;color:#2d2d2d;">Node 1, 1,000 camps<span style="display:block;font-size:11px;color:#888;margin-top:2px;">sees only 1,000 of 10,000 campaigns</span></div>
  <div style="height:6px;"></div>
  <div style="background:#f5f5f5;border:1.5px solid #c0c0c0;border-radius:6px;padding:9px 20px;text-align:center;font-size:13px;color:#2d2d2d;">Node 2, 1,000 camps</div>
  <div style="color:#c0c0c0;font-size:22px;margin:6px 0;line-height:1;">⋮</div>
  <div style="color:#888;font-size:12px;">× 10 nodes</div>
</div>

This is a fundamental issue with random (round-robin) routing. Every node is equally likely to receive a bid request, but no node has visibility of all campaigns. Horizontal scaling adds capacity but hurts utilization.

## The Solution: A Custom Reverse Proxy

We built a reverse proxy that sits in front of the compute nodes. Instead of routing requests randomly, it routes each bid request to the node most likely to have a matching campaign.

The proxy does not run the full filtering logic, that is too CPU-heavy. Instead, it applies a small number of fast, lightweight filter checks. The goal is to eliminate clearly wrong nodes and increase the probability that a bid request lands on a node with a matching campaign.

<div style="display:flex;flex-direction:column;align-items:center;font-family:system-ui,sans-serif;margin:24px 0;">
  <div style="background:#f5f5f5;border:1.5px solid #c0c0c0;border-radius:6px;padding:9px 20px;text-align:center;font-size:13px;color:#2d2d2d;">Bid Request</div>
  <div style="display:flex;justify-content:center;margin:3px 0;"><svg width="14" height="20" viewBox="0 0 14 20"><line x1="7" y1="0" x2="7" y2="13" stroke="#c0c0c0" stroke-width="1.5"/><polygon points="7,20 2,12 12,12" fill="#c0c0c0"/></svg></div>
  <div style="background:#f5f5f5;border:1.5px solid #c0c0c0;border-radius:6px;padding:9px 20px;text-align:center;font-size:13px;color:#2d2d2d;">Reverse Proxy (Go + Redis)<span style="display:block;font-size:11px;color:#888;margin-top:2px;">applies lightweight filter logic</span></div>
  <div style="display:flex;justify-content:center;margin:3px 0;"><svg width="14" height="20" viewBox="0 0 14 20"><line x1="7" y1="0" x2="7" y2="13" stroke="#c0c0c0" stroke-width="1.5"/><polygon points="7,20 2,12 12,12" fill="#c0c0c0"/></svg></div>
  <div style="display:flex;gap:32px;">
    <div style="background:#f5f5f5;border:1.5px solid #c0c0c0;border-radius:6px;padding:9px 20px;text-align:center;font-size:13px;color:#2d2d2d;">Node 1<span style="display:block;font-size:11px;color:#888;margin-top:2px;">1,000 camps</span></div>
    <div style="background:#f5f5f5;border:1.5px solid #c0c0c0;border-radius:6px;padding:9px 20px;text-align:center;font-size:13px;color:#2d2d2d;">Node 3<span style="display:block;font-size:11px;color:#888;margin-top:2px;">1,000 camps</span></div>
  </div>
  <div style="font-size:11px;color:#888;margin-top:8px;">best candidates for this request</div>
</div>

We built this in Go using the standard `net/http/httputil.ReverseProxy` package with custom routing logic. Redis stores per-node metadata, the campaigns each node holds and which targeting dimensions they cover.

We store this metadata in Redis instead of loading it into Go's memory as a large map. The reason: keeping millions of entries in a `map[string]string` inside a Go process puts heavy pressure on the garbage collector. Go's GC must scan every pointer in the map on every cycle, which causes periodic CPU spikes and unpredictable tail latency. Moving the data to Redis removes it from Go's heap entirely. We covered this issue in detail in [Large Maps Are Bad for Go GC](./large-maps-are-bad-for-go-gc.md), which we discovered while building this proxy.

## How the Routing Works

When a bid request arrives at the proxy:

1. Read key attributes from the request (e.g. country, device type, ad format).
2. For each compute node, check Redis to see if that node has any active campaigns that match those attributes.
3. Route the request to the node with the highest number of potential matches.

We only apply a few fast filter checks, the ones with high selectivity and low compute cost. The full filtering (budget checks, frequency caps, etc.) still happens on the compute node.

<div style="display:flex;flex-direction:column;align-items:center;font-family:system-ui,sans-serif;margin:24px 0;">
  <div style="background:#f5f5f5;border:1.5px solid #c0c0c0;border-radius:6px;padding:9px 20px;text-align:center;font-size:13px;color:#2d2d2d;min-width:220px;">Bid Request</div>
  <div style="display:flex;justify-content:center;margin:3px 0;"><svg width="14" height="20" viewBox="0 0 14 20"><line x1="7" y1="0" x2="7" y2="13" stroke="#c0c0c0" stroke-width="1.5"/><polygon points="7,20 2,12 12,12" fill="#c0c0c0"/></svg></div>
  <div style="background:#f5f5f5;border:1.5px solid #c0c0c0;border-radius:6px;padding:9px 20px;text-align:center;font-size:13px;color:#2d2d2d;min-width:220px;">Parse Request Attrs<span style="display:block;font-size:11px;color:#888;margin-top:2px;">country, device, format…</span></div>
  <div style="display:flex;justify-content:center;margin:3px 0;"><svg width="14" height="20" viewBox="0 0 14 20"><line x1="7" y1="0" x2="7" y2="13" stroke="#c0c0c0" stroke-width="1.5"/><polygon points="7,20 2,12 12,12" fill="#c0c0c0"/></svg></div>
  <div style="background:#f5f5f5;border:1.5px solid #c0c0c0;border-radius:6px;padding:9px 20px;text-align:center;font-size:13px;color:#2d2d2d;min-width:220px;">Query Redis<span style="display:block;font-size:11px;color:#888;margin-top:2px;">which nodes have matching campaigns?</span></div>
  <div style="display:flex;justify-content:center;margin:3px 0;"><svg width="14" height="20" viewBox="0 0 14 20"><line x1="7" y1="0" x2="7" y2="13" stroke="#c0c0c0" stroke-width="1.5"/><polygon points="7,20 2,12 12,12" fill="#c0c0c0"/></svg></div>
  <div style="background:#f5f5f5;border:1.5px solid #c0c0c0;border-radius:6px;padding:9px 20px;text-align:center;font-size:13px;color:#2d2d2d;min-width:220px;">Pick Best Node<span style="display:block;font-size:11px;color:#888;margin-top:2px;">highest match potential</span></div>
  <div style="display:flex;justify-content:center;margin:3px 0;"><svg width="14" height="20" viewBox="0 0 14 20"><line x1="7" y1="0" x2="7" y2="13" stroke="#c0c0c0" stroke-width="1.5"/><polygon points="7,20 2,12 12,12" fill="#c0c0c0"/></svg></div>
  <div style="background:#f5f5f5;border:1.5px solid #c0c0c0;border-radius:6px;padding:9px 20px;text-align:center;font-size:13px;color:#2d2d2d;min-width:220px;">Forward to Node</div>
</div>

## Upstream Health Checks

A naive reverse proxy forwards traffic to any node that is alive. We need two additional checks.

### Check 1: Node is Up

This is standard. If a node does not respond to health checks, we stop sending requests to it. We poll each node's health endpoint and remove failed nodes from the routing pool.

### Check 2: Node Has Active Campaigns

This one is less obvious. When a node crashes and restarts, it comes back up healthy but empty, it has no active campaigns yet because it has not finished loading its campaign data from the data store.

This is a real problem. An empty node responds to requests very fast (it has no campaigns to check, so it does nothing). Without this check, the proxy would see a fast, healthy node and flood it with traffic. The node would respond quickly with zero bids, wasting every single request.

We require each compute node to expose an API endpoint that returns its current active campaign count:

```
GET /status
{
  "active_campaigns": 1024
}
```

The proxy checks this count. If it is zero (or below a minimum threshold), the node is skipped from the routing pool until it is ready.

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
          <div style="background:#f5f5f5;border:1.5px solid #c0c0c0;border-radius:6px;padding:9px 14px;text-align:center;font-size:13px;color:#2d2d2d;">Skip node</div>
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

After deploying the custom routing proxy, our match rate increased by around **30%**. This came entirely from routing bid requests to nodes that have relevant campaigns, instead of routing randomly.

The trade-off is added latency. The proxy needs to query Redis and run routing logic before forwarding. This adds around **5ms** to each request. For our system, that is acceptable, bid requests have a strict deadline (usually 100ms total), and 5ms leaves enough room for the compute node to do full filtering and ML scoring.

The proxy also adds one more component to the system. We run it with multiple instances behind a load balancer to avoid it becoming a single point of failure.

## Key Takeaways

1. **Random routing is not always right.** In systems where data is partitioned across nodes, routing requests randomly means lower utilization. Custom routing improves match rate without adding hardware.
2. **Do lightweight filtering at the proxy layer.** Running full filtering at the proxy is too expensive. A few fast checks are enough to make better routing decisions.
3. **Healthy does not mean ready.** A node that just restarted can appear healthy but have no data. Check application-level readiness, not just network-level liveness.
4. **Fast nodes attract traffic.** An empty node responds fast. Without readiness checks, a proxy will send it all the traffic. Always check for readiness before routing.
