friends_lengths = [24, 24, 25, 24, 24, 25, 24, 24, 23, 17]
number_of_ee = 23

youtube_links = [
    ['https://www.youtube.com/embed/q7r9C3y7dkQ', 'Tu duy cua mot nha khoa hoc'],
    ['https://www.youtube.com/embed/a8osNOpkCvY', 'Long yeu nuoc'],
    ['https://www.youtube.com/embed/H14bBuluwB8', 'Grit: the power of passion and perseverance'],
]

function init_friends() {
    const option_list = document.querySelector('#friends_selector');


    for (let i = 1; i <= friends_lengths.length; i++) {
        for (let j = 1; j <= friends_lengths[i]; j++) {

            session = addPreZero(i)
            episode = addPreZero(j)

            result = 's' + session + 'e' + episode

            option_list.options[option_list.options.length]
                = new Option(result, result)
        }
    }
}

function change_friend(value) {
    const player = document.querySelector('#friends_player');
    const sub = player.getElementsByTagName('track')[0];
    player.src = '/pub/friends/videos/' + value + '.mp4'
    sub.src = '/pub/friends/sub/' + value + '.vtt'
}

function init_ee() {
    const option_list = document.querySelector('#ee_selector');

    for (let i = 1; i <= number_of_ee; i++) {
            session = addPreZero(i)

            option_list.options[option_list.options.length]
                = new Option(session, session)
    }
}

function change_ee(value) {
    const player = document.querySelector('#ee_player');
    player.src = '/pub/ee/' + value + '.mp3'
}

function init_youtube() {
    const option_list = document.querySelector('#youtube_selector');

    for (let i = 0; i < youtube_links.length; i++) {
            option_list.options[option_list.options.length]
                = new Option(youtube_links[i][1], youtube_links[i][0])
    }
}

function change_youtube(value) {
    const player = document.querySelector('#youtube-player');
    player.src = value
}

function addPreZero(num) {
    if (num < 10) {
        return '0' + num
    }
    return '' + num
}

function init() {
    init_friends()
    init_ee()
    init_youtube()
}

setTimeout(init, 10)
