<h3>Friends</h3>

<select class="selector" id="friends_selector" onchange="change_friend(this.value)"></select>
<br>
<video class="player" id="friends_player" controls>
    <source src="/pub/friends/videos/s01e01.mp4" type="video/mp4 ">
    <track label="English" kind="subtitles" srclang="en" src="/pub/friends/sub/s01e01.vtt" default>
</video>

<hr>

<h3>Effortless english</h3>
<select class="selector" id="ee_selector" onchange="change_ee(this.value)"></select>
<br>
<audio class="player" id="ee_player" controls>
    <source src="/pub/ee/01.mp3" type="audio/mpeg">
</audio>

<hr>

<video class="player" controls>
    <source src="/pub/nhackhongloi.mp4" type="video/mp4 ">
</video>

<hr>

<h3>Youtubes</h3>

<select class="selector" id="youtube_selector" onchange="change_youtube(this.value)"></select>
<br>
<div class="wrapper">
    <iframe id="youtube-player"
        src="https://www.youtube.com/embed/q7r9C3y7dkQ"
        frameborder="0"
        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
        allowfullscreen>
    </iframe>
</div>

<!-- styles and scripts -->
<script src="/main.js"></script>
<link rel="stylesheet" href="/styles.css">