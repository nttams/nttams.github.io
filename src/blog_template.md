<div>
    <h4 style="margin: 0px; padding: 0px">{{ page.title }}</h4>
    <p style="margin: 0px; padding: 0px; color: #696969; font-size: 1.5rem">{% block date %}Undefined date{% endblock %}</p>
    <hr style="margin: 5px 0px 10px 0px; padding: 0px">
</div>

{% block content %} Undefined content {% endblock %}

{% include "/footer.md" %}
