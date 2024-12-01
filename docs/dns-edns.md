---
sidebar_position: 2
---

# DNS - EDNS

Normally, max size of a UDP DNS message is 512 octets, DNS request is usually smaller than this, but the response may be larger. If the server notices the response exceeds the limit, it will set the truncated bit (TC) to on. When the client receives the response with TC bit ON, it must choose to discard the response or fallback to TCP.

With EDNS, the client and server can negotiate the max size of udp message, recommended value is 1280. EDNS does this by adding a OPT resource record to the additional fields of the request to indicate that the client supports EDNS. When the server receives an EDNS request, if it does not support EDNS, it must respond with a non-EDNS response with RCODE=FORMERR

EDNS has much more new features, like extended RCODE and many types of Options in OPT record