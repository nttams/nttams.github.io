{% extends "/blog_template.md" %}

{% block date %} 2022/06/21 {% endblock %}

{% block content %}

Hashing is a simple but effective way to distribute loads access nodes in cluster.

A very simple way to do so is to hash some attributes in the request and the get modulo to number of node in the cluster.

Another improved technique is to use consistent hashing.

{% endblock %}