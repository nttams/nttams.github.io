---
layout: default
title: "Home"
---

[Github](https://github.com/nttams)
[Linkedin](https://www.linkedin.com/in/ngothtam/)

I'm a software engineer with experiences in backend, distributed, and real time system in advertising space (Real-time bidding). Most of my work involve Golang and C++, sometimes Python and Bash as scripting languages.

What I have done:
- Build a whole new service in Golang from scratch, it acts as an gateway to route traffic to the right upstream, each instance can handle 4000 QPS HTTP with 4CPUs and 4GB of memory
- Design and implement a real-time weather targeting feature, it involves geo indexing, real time hit/miss caching with Redis and external API call. Take a look here [Weather augmentation]({% link _posts/2025-08-16-weather-augmentation-realtime.md %})

- design and implement new features
- optimize backend system to improve performance and reduce infra cost
- study RFC, documentation, source code
- handle support tickets from tester and customers

## Posts

<ul class="post-list">
{% for post in site.posts %}
  <li>
    <a href="{{ post.url | relative_url }}">{{ post.title }}</a>
    <time datetime="{{ post.date | date_to_xmlschema }}">
      {{ post.date | date: "%b %d, %Y" }}
    </time>
  </li>
{% endfor %}
</ul>
