if ('serviceWorker' in navigator) {
	navigator.serviceWorker.register('/js/worker.js?v0.0.1').then(function() {
		console.log('registered worker');
	}).catch(function() {
		console.log('did not register worker');
	});
} else {
	console.log('workers not supported');
}

$(document).ready(function() {
	$('pre code').each(function(i, block) {
		if ($(block).hasClass('lang-shell')) {
			var lines = $(block).html().split('\n');
			var html = '';
			var line;
			for (var i = 0; i < lines.length; i++) {
				line = lines[i];
				if (line.trim() == '') {
					continue;
				}
				if (line.match(/^\$ /)) {
					line = line.replace(/^\$ /, '');
					html += '<li class="prompt">' + line + '</li>';
				} else {
					html += '<li>' + line + '</li>';
				}
			}
			html = '<ul>' + html + '</ul>';
			$(block).html(html);
		} else {
			hljs.lineNumbersBlock(block);
		}
		hljs.highlightBlock(block);
	});

	$('iframe').each(function(i, block) {
		$(block).wrap('<div class="embed"></div>');
	});

	function setup_tweets() {
		$('.tweet').each(function(i, el) {
			var $link = $(el).find('a');
			if ($link.length == 0) {
				return;
			}
			var url = $link.attr('href');
			var url_match = url.match(/status\/(\d+)$/);
			if (url_match) {
				twttr.widgets.createTweet(url_match[1], el, {
					width: 700,
					linkColor: '#0330AF'
				});
				$link.css('display', 'none');
			}
			twttr.widgets.load();
		});
	}

	function check_twttr() {
		if (typeof twttr == 'object' && 'widgets' in twttr) {
			setup_tweets();
		} else {
			setTimeout(function() {
				check_twttr();
			}, 500);
		}
	}

	check_twttr();

	function keyboard_stops() {
		var stops = [];
		$('.gallery figure').each(function(i, figure) {
			var top = Math.round($(figure).offset().top) - 15;
			if (stops.indexOf(top) === -1) {
				stops.push(top);
			}
		});
		return stops;
	}

	function keyboard_curr_stop(stops) {
		var stops = keyboard_stops();
		for (i = 0; i < stops.length; i++) {
			if (stops[i] > window.scrollY) {
				break;
			}
		}
		return i;
	}

	function keyboard_next(stops) {
		var stops = keyboard_stops();
		var index = keyboard_curr_stop(stops);
		if (index < stops.length) {
			window.scrollTo(0, stops[index]);
		}
	}

	function keyboard_prev(stops) {
		var stops = keyboard_stops();
		var index = keyboard_curr_stop(stops);
		if (index > 0) {
			window.scrollTo(0, stops[index - 2]);
		}
	}

	function keyboard_nav() {
		$(document).on('keypress', function(e) {
			if (e.which == 106) { // j
				keyboard_next();
			} else if (e.which == 107) { // k
				keyboard_prev();
			}
		});
	}

	if ($('.gallery').length > 0) {
		keyboard_nav();
	}

	$('#user a').click(function(e) {
		e.preventDefault();
		var $link = $(e.target);
		if ($link[0].nodeName != 'A') {
			$link = $link.closest('a');
		}
		if ($link.hasClass('menu-toggle')) {
			$('#user-menu').toggleClass('visible');
		} else if ($link.hasClass('login') ||
		           $link.hasClass('join')) {
			if ($('#join').hasClass('visible') && $link.hasClass('login')) {
				$('#join').removeClass('visible');
			} else if ($('#login').hasClass('visible') && $link.hasClass('join')) {
				$('#login').removeClass('visible');
			} else {
				$('header').toggleClass('fullscreen');
			}
			if ($('header').hasClass('fullscreen')) {
				if ($link.hasClass('login')) {
					$('#login').addClass('visible');
					$('#login input[name="email"]')[0].select();
				} else {
					$('#login').removeClass('visible');
					$('#join').addClass('visible');
					$('#join input[name="email"]')[0].select();
				}
			} else {
				$('#join').removeClass('visible');
				$('#login').removeClass('visible');
			}
		}
	});

	$('#user-menu .logout').click(function(e) {
		e.preventDefault();
		$.post('/api/logout', function(data) {
			if (! 'ok' in data ||
			    ! data.ok) {
				console.error(data);
			} else {
				// reload
				window.location = location.href;
			}
		});
	});

	$('header form').submit(function(e) {
		e.preventDefault();
		var action = $(e.target).attr('action');
		var params = $(e.target).serialize();
		$.post(action, params, function(data) {
			if (! 'ok' in data ||
			    ! data.ok) {
				if ('error' in data) {
					$(e.target).find('.response').html(data.error);
				} else {
					$(e.target).find('.response').html('Oh no, something went wrong.');
				}
			} else {
				// reload
				window.location = location.href;
			}
		});
	});
});

$(window).on('load', function() {
	$('.gallery img').each(function(i, img) {
		if ($(img).height() > $(img).width()) {
			var $item = $(img).closest('li');
			$item.addClass('vertical');
			if ($item.prev('li').hasClass('vertical') &&
			    ! $item.prev('li').hasClass('half-width')) {
				$item.addClass('half-width');
				$item.addClass('second-half');
				$item.prev('li').addClass('half-width');
				$item.next('li').addClass('clear');
			}
		}
	});
});

window.twttr = (function(d, s, id) {
	var js, fjs = d.getElementsByTagName(s)[0],
	t = window.twttr || {};
	if (d.getElementById(id)) return t;
	js = d.createElement(s);
	js.id = id;
	js.src = "https://platform.twitter.com/widgets.js";
	fjs.parentNode.insertBefore(js, fjs);

	t._e = [];
	t.ready = function(f) {
		t._e.push(f);
	};

	return t;
}(document, "script", "twitter-wjs"));
