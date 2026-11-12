'use strict';
'require view';
'require fs';
'require uci';
'require ui';

return view.extend({
	handleSaveApply: null,
	handleSave: null,
	handleReset: null,

	load: function() {
		return Promise.all([
			uci.load('linkspeed'),
			L.resolveDefault(uci.load('network')) // Standard OpenWrt method to ensure network config is loaded
		]);
	},

	render: function() {
		var cnUrls = uci.get('linkspeed', 'config', 'cn_url') || uci.get('linkspeed', 'config', 'url') || [];
		var globalUrls = uci.get('linkspeed', 'config', 'global_url') || [];
		if (!Array.isArray(cnUrls)) cnUrls = [ cnUrls ];
		if (!Array.isArray(globalUrls)) globalUrls = [ globalUrls ];
		var customUrls = uci.get('linkspeed', 'config', 'custom_url') || [];
		if (!Array.isArray(customUrls)) customUrls = [ customUrls ];
		var customUrlsInput = E('textarea', {
			'class': 'cbi-input-textarea',
			'rows': 3,
			'placeholder': 'https://example.com/test.bin',
			'change': function() {
				var lines = this.value.split('\n').filter(function(line) { return line.trim() !== ''; });
				uci.set('linkspeed', 'config', 'custom_url', lines);
				uci.save('linkspeed');
				refreshTargets();
			}
		});
		customUrlsInput.value = customUrls.join('\n');

		
		var SERVER_NAMES = {
			'http://hkg.download.datapacket.com/100mb.bin': 'HKG Datapacket (HK)',
			'http://sgp.download.datapacket.com/100mb.bin': 'SGP Datapacket (SG)',
			'http://tyo.download.datapacket.com/100mb.bin': 'TYO Datapacket (JP)',
			'http://cachefly.cachefly.net/100mb.test': 'CacheFly (Global)',
			'https://speed.cloudflare.com/__down?during=download&bytes=104857600': 'Cloudflare (Global)',
			'https://mirrors.aliyun.com/ubuntu-releases/24.04/ubuntu-24.04.1-live-server-amd64.iso': 'Aliyun (CN)',
			'https://mirrors.tuna.tsinghua.edu.cn/ubuntu-releases/24.04/ubuntu-24.04.1-live-server-amd64.iso': 'Tsinghua (CN)'
		};
		function getServerName(url, fallbackPrefix) {
			var name = SERVER_NAMES[url];
			if (name) return name + ' - ' + url;
			return (fallbackPrefix ? fallbackPrefix + ': ' : '') + url;
		}

		var profile = E('select', { 'class': 'cbi-input-select' }, [
			E('option', { 'value': 'cn' }, _('China Mainland Nodes')),
			E('option', { 'value': 'global' }, _('Overseas Nodes')),
			E('option', { 'value': 'custom' }, _('Custom Backends'))
		]);
		var cnUploadUrl = uci.get('linkspeed', 'config', 'cn_upload_url') || uci.get('linkspeed', 'config', 'upload_url') || 'https://test.nju.edu.cn/backend/empty.php';
		var globalUploadUrl = uci.get('linkspeed', 'config', 'global_upload_url') || cnUploadUrl;

		var activeRun = 0;
		var selected = E('select', { 'class': 'cbi-input-select' });
		function activeUrls() { return profile.value === 'global' ? globalUrls : cnUrls; }
		function activeUploadUrl() { return profile.value === 'global' ? globalUploadUrl : cnUploadUrl; }
		function refreshTargets() {
			selected.innerHTML = '';
			if (profile.value === 'custom') {
				customUrls.forEach(function(url, index) { selected.appendChild(E('option', { 'value': url }, getServerName(url, 'Custom ' + (index + 1)))); });
			} else {
				activeUrls().forEach(function(url, index) { selected.appendChild(E('option', { 'value': url }, getServerName(url, (index + 1) + '. '))); });
			}
			selected.appendChild(E('option', { 'value': '__custom__' }, _('Custom Temporary Link')));
		}
		profile.addEventListener('change', refreshTargets);
		refreshTargets();
		var custom = E('input', {
			'class': 'cbi-input-text',
			'type': 'url',
			'placeholder': 'https://example.com/test.bin'
		});
		// uci.sections() returns an array of strings, not objects
		// uci.sections() returns objects, we must map them to their names
		var dynamicIfaces = uci.sections('network', 'interface').map(function(s) { return s['.name']; });
		
		// Filter out loopback and LAN (standard practice: LAN is not a WAN)
		dynamicIfaces = dynamicIfaces.filter(function(i) { 
			return i !== 'loopback' && i !== 'lan'; 
		});
		
		// Fallback if no interfaces found
		if (dynamicIfaces.length === 0) dynamicIfaces = ['wan'];
		
		var ifaceInput = E('select', { 'class': 'cbi-input-select', 'change': function() {
			uci.set('linkspeed', 'config', 'interface', this.value);
			uci.save('linkspeed');
		} }, dynamicIfaces.map(function(i) {
			return E('option', { 'value': i }, i);
		}));
		ifaceInput.value = uci.get('linkspeed', 'config', 'interface') || 'wan';

		var duration = E('input', {
			'class': 'cbi-input-text', 'type': 'number', 'min': '3', 'max': '86400',
			'value': uci.get('linkspeed', 'config', 'duration') || '15'
		});
		var pingCount = E('input', { 'class': 'cbi-input-text', 'type': 'number', 'min': '1', 'max': '20', 'value': '5' });
		var concurrency = E('input', { 'class': 'cbi-input-text', 'type': 'number', 'min': '2', 'max': '10', 'value': '5' });
		var maxMb = E('input', {
			'class': 'cbi-input-text', 'type': 'number', 'min': '0',
			'value': uci.get('linkspeed', 'config', 'max_megabytes') || '100'
		});
		var maxMbHint = E('div', {
			'class': 'cbi-value-description',
			'style': 'max-width:52em;line-height:1.55'
		}, _('Enter 0 for unlimited traffic, stop only by duration. A positive number is the total traffic limit per direction, evenly distributed across 5 concurrent streams; simultaneous up/down tests are calculated separately.'));
		var historyLimit = E('input', {
			'class': 'cbi-input-text', 'type': 'number', 'min': '1', 'max': '200', 'value': '20'
		});
		var historyResult = E('div', {}, _('Click Refresh History to read saved records.'));
		var result = E('div', { 'class': 'cbi-section' }, [
			E('div', { 'class': 'alert-message notice' }, _('Test not started yet.'))
		]);

		function setStatus(text, style) {
			result.innerHTML = '';
			result.appendChild(E('div', { 'class': 'alert-message ' + (style || 'notice') }, text));
		}

		function validNumber(input, min, max) {
			var value = Number(input.value);
			return Number.isInteger(value) && value >= min && value <= max;
		}

		function confirmLongTest(mode) {
			var seconds = Number(duration.value);
			var traffic = Number(maxMb.value) === 0 ? _('Unlimited (manually stop or wait for max duration)') : maxMb.value + ' MB';
			return window.confirm(
				_('About to start speed/stress test.') + '\n\n' +
				_('Mode: ') + mode + '\n' +
				_('Max Duration: ') + seconds + _(' seconds') + '\n' +
				_('Max Traffic per Direction: ') + traffic + '\n\n' +
				_('The test will continuously use WAN bandwidth and may generate large amounts of mobile data. Continue?')
			);
		}

		var live = null;

		function beginLiveChart() {
			var stats = E('p', { 'style': 'font-size:1.15em;font-weight:bold' }, _('Waiting for first second sample...'));
			var summary = E('p', {}, '');
			var canvas = E('canvas', { 'width': '640', 'height': '220', 'style': 'width:100%;max-width:900px;height:220px;background:#202020;border-radius:4px' });
			
			// Define liveDownloaded BEFORE appending it to the UI
			var liveDownloaded = E('div', { 'class': 'cbi-value', 'style': 'margin-top: 5px;' }, [ 
				E('strong', {}, _('Total Downloaded: ')), 
				E('span', { 'id': 'linkspeed-live-total' }, '0.00 MiB') 
			]);

			result.innerHTML = '';
			result.appendChild(E('div', { 'class': 'cbi-section' }, [
				E('h3', {}, _('WAN Realtime Speed (per second sampling)')),
				stats, liveDownloaded, summary, canvas,
				E('p', { 'class': 'cbi-value-description' }, _('Purple: Download Cyan: Upload Source: Selected interface byte count'))
			]));

			live = { stats: stats, summary: summary, canvas: canvas, previous: null, samples: [], initialRx: null };
		}

		function updateLiveChart(rx, tx) {
			if (!live || !isFinite(rx) || !isFinite(tx)) return;
			var now = Date.now();
			if (live.initialRx === null) live.initialRx = rx;
			if (document.getElementById('linkspeed-live-total')) {
				var totalBytes = rx - live.initialRx;
				document.getElementById('linkspeed-live-total').textContent = (totalBytes / 1048576).toFixed(2) + ' MiB';
			}
			if (live.previous) {
				var seconds = Math.max((now - live.previous.time) / 1000, 0.1);
				var down = Math.max(0, rx - live.previous.rx) * 8 / seconds / 1000000;
				var up = Math.max(0, tx - live.previous.tx) * 8 / seconds / 1000000;
				live.samples.push({ down: down, up: up });
				if (live.samples.length > 600) live.samples.shift();
				var peakDown = 0, peakUp = 0, sumDown = 0, sumUp = 0;
				live.samples.forEach(function(s) {
					peakDown = Math.max(peakDown, s.down); peakUp = Math.max(peakUp, s.up);
					sumDown += s.down; sumUp += s.up;
				});
				live.stats.textContent = _('Current Download: ') + down.toFixed(2) + ' Mbps　' + _('Current Upload: ') + up.toFixed(2) + ' Mbps';
				live.summary.textContent = _('Average: ') + (sumDown / live.samples.length).toFixed(2) + ' / ' + (sumUp / live.samples.length).toFixed(2) + ' Mbps　' + _('Peak: ') + peakDown.toFixed(2) + ' / ' + peakUp.toFixed(2) + ' Mbps';
				var ctx = live.canvas.getContext('2d'), w = live.canvas.width, h = live.canvas.height;
				var max = Math.max(10, peakDown, peakUp) * 1.1;
				ctx.clearRect(0, 0, w, h); ctx.strokeStyle = '#444'; ctx.lineWidth = 1;
				for (var g = 1; g < 4; g++) { ctx.beginPath(); ctx.moveTo(0, h * g / 4); ctx.lineTo(w, h * g / 4); ctx.stroke(); }
				function line(key, color) {
					ctx.beginPath(); ctx.strokeStyle = color; ctx.lineWidth = 2;
					live.samples.forEach(function(s, i) { var x = live.samples.length > 1 ? i * w / (live.samples.length - 1) : 0; var y = h - s[key] / max * h; if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y); });
					ctx.stroke();
				}
				line('down', '#9b87f5'); line('up', '#58d5d2');
				ctx.fillStyle = '#ddd'; ctx.font = '12px sans-serif'; ctx.fillText(max.toFixed(0) + ' Mbps', 8, 15); ctx.fillText(_('Recent max  600 seconds'), w - 110, h - 8);
			}
			live.previous = { rx: rx, tx: tx, time: now };
		}

		
		function runPing() {
			var url = selected.value;
			if (url === '__custom__') url = custom.value;
			if (!url) return;

			var host = url.replace(/^https?:\/\//, '').split('/')[0];
			setStatus(_('Testing ping and jitter to ') + host + '...', 'notice');

			var section = document.getElementById('linkspeed-ping-section');
			
			// Show a clean loading state
			if (section) {
				section.style.display = 'block';
				section.innerHTML = '<h3>' + _('Ping & Jitter Result') + '</h3>' +
					'<div class="cbi-section-node">' +
						'<div class="cbi-value"><label class="cbi-value-title">' + _('Status') + '</label><div class="cbi-value-field"><em>' + _('Pinging ') + host + '...</em></div></div>' +
					'</div>';
			}

			return fs.exec('/usr/libexec/linkspeed-ping', [ url, pingCount.value ]).then(function(res) {
				var out = String(res.stdout || '').trim();
				var parts = out.split('|');
				if (Number(parts[0]) === 0) parts[0] = parts[1];
				if (Number(parts[2]) === 0) parts[2] = parts[1];
				
				if (parts.length === 4 && Number(parts[1]) > 0) {
					// Render a beautiful LuCI table
					if (section) {
						section.innerHTML = '<h3 style="font-size: 1.4em; font-weight: bold; margin-bottom: 15px;">' + _('Ping & Jitter Result') + '</h3>' +
							'<div class="cbi-section-node" style="padding: 10px 0;">' +
								'<div class="cbi-value" style="margin-bottom: 10px;"><label class="cbi-value-title" style="font-size: 1.2em; color: #aaaaaa;">' + _('Host') + '</label><div class="cbi-value-field"><span style="font-size: 1.3em; color: #4da6ff; font-weight: bold;">' + host + '</span></div></div>' +
								'<div class="cbi-value" style="margin-bottom: 10px;"><label class="cbi-value-title" style="font-size: 1.2em; color: #aaaaaa;">' + _('Average Latency') + '</label><div class="cbi-value-field"><span style="font-size: 1.6em; color: #00ff00; font-weight: bold;">' + parts[1] + ' ms</span></div></div>' +
								'<div class="cbi-value" style="margin-bottom: 10px;"><label class="cbi-value-title" style="font-size: 1.2em; color: #aaaaaa;">' + _('Min / Max') + '</label><div class="cbi-value-field"><span style="font-size: 1.3em; color: #ffffff;">' + parts[0] + ' ms / ' + parts[2] + ' ms</span></div></div>' +
								'<div class="cbi-value"><label class="cbi-value-title" style="font-size: 1.2em; color: #aaaaaa;">' + _('Jitter') + '</label><div class="cbi-value-field"><span style="font-size: 1.3em; color: #ffca28;">' + parts[3] + ' ms</span></div></div>' +
							'</div>';
					}
					setStatus(_('Ping test completed successfully.'), 'success');
				} else {
					if (section) {
						section.innerHTML = '<h3>' + _('Ping Result') + '</h3><div class="cbi-section-node"><div class="cbi-value"><div class="cbi-value-field" style="color:red;">' + _('Server Unreachable or Timeout.') + '</div></div></div>';
					}
					setStatus(_('Ping failed.'), 'error');
				}
			}).catch(function(err) {
				if (section) section.innerHTML = '<h3>' + _('Ping Error') + '</h3><div class="cbi-section-node"><div class="cbi-value"><div class="cbi-value-field" style="color:red;">' + String(err) + '</div></div></div>';
				setStatus(_('Ping error.'), 'error');
			});
		}

		function runJob(program, args) {
			var jobId = String(Date.now());
			beginLiveChart();
			return fs.exec('/usr/libexec/linkspeed-start', [ jobId, program, historyLimit.value ].concat(args)).then(function() {
				return new Promise(function(resolve, reject) {
					function poll() {
						fs.exec('/usr/libexec/linkspeed-status', [ jobId ]).then(function(res) {
							var output = String(res.stdout || '');
							var pos = output.indexOf('\n');
							var header = (pos >= 0 ? output.substring(0, pos) : output).trim().split('|');
							var state = header[0];
							var body = pos >= 0 ? output.substring(pos + 1) : '';
							updateLiveChart(Number(header[1]), Number(header[2]));
							if (state === 'RUNNING')
								window.setTimeout(poll, 2000);
							else if (state === 'DONE')
								resolve({ stdout: body });
							else
								reject(new Error(body.trim() || _('Speed test task failed')));
						}).catch(reject);
					}
					poll();
				});
			});
		}

		function parseMetrics(line) {
			var fields = String(line || '').trim().split('|');
			if (fields.length !== 8)
				throw new Error(_('Invalid data format returned by speed test program'));
			return {
				http_code: Number(fields[0] || 0),
				remote_ip: fields[1] || '',
				size_download: Number(fields[2] || 0),
				speed_download: Number(fields[3] || 0),
				time_namelookup: Number(fields[4] || 0),
				time_connect: Number(fields[5] || 0),
				time_starttransfer: Number(fields[6] || 0),
				time_total: Number(fields[7] || 0)
			};
		}

		function runSingle() {
			var runId = ++activeRun;
			var url = selected.value === '__custom__' ? custom.value.trim() : selected.value;
			if (!/^https?:\/\//i.test(url)) {
				setStatus(_('Please enter a valid HTTP/HTTPS direct link.'), 'error');
				return;
			}
			if (!validNumber(duration, 3, 86400) || !validNumber(maxMb, 0, Number.MAX_SAFE_INTEGER)) {
				setStatus(_('Please check test duration and max download amount.'), 'error');
				return;
			}
			if (!confirmLongTest(_('Single Node Download'))) return;
			setStatus(_('Single Node Test in progress, click "Stop Immediately" at any time...'), 'notice');
			runJob('linkspeed-test', [ url, duration.value, maxMb.value ]).then(function(res) {
				if (runId !== activeRun) return;
				var data = parseMetrics(res.stdout);
				var mbps = Number(data.speed_download || 0) * 8 / 1000000;
				if (mbps === 0) {
					throw new Error(_('Test failed. HTTP Status: ') + (data.http_code || 'Unknown') + _('. The server may be blocking requests or timing out.'));
				}
				result.innerHTML = '';
				result.appendChild(E('div', { 'class': 'cbi-section' }, [
					E('h3', {}, _('Single Node Result')),
					E('p', { 'style': 'font-size:1.35em;font-weight:bold' }, mbps.toFixed(2) + ' Mbps (' + (mbps / 8).toFixed(2) + ' MB/s)'),
					E('p', {}, _('Downloaded: ') + (Number(data.size_download || 0) / 1048576).toFixed(2) + ' MiB'),
					E('p', {}, 'HTTP ' + data.http_code + '　TTFB ' + (Number(data.time_starttransfer || 0) * 1000).toFixed(1) + ' ms　IP ' + (data.remote_ip || '-'))
				]));
			}).catch(function(err) {
				if (runId === activeRun) setStatus(_('Test failed: ') + String(err.message || err), 'error');
			});
		}

		function runMulti() {
			var runId = ++activeRun;
			var num = Number(concurrency.value) || 5; var targets = activeUrls().slice(0, num);
			if (targets.length < 2 || !validNumber(duration, 3, 86400) || !validNumber(maxMb, 0, Number.MAX_SAFE_INTEGER)) {
				setStatus(_('Invalid number of nodes or Test Parameters.'), 'error');
				return;
			}
			if (!confirmLongTest(_('Five Node Concurrent Download'))) return;
			setStatus(_('Five Node Concurrent Test in progress, click "Stop Immediately" at any time...'), 'notice');
			runJob('linkspeed-test-multi', [ duration.value, maxMb.value ].concat(targets)).then(function(res) {
				if (runId !== activeRun) return;
				var results = (res.stdout || '').trim().split(/\n+/).map(parseMetrics);
				var bytes = results.reduce(function(sum, item) { return sum + Number(item.size_download || 0); }, 0);
				var elapsed = results.reduce(function(max, item) { return Math.max(max, Number(item.time_total || 0)); }, 0);
				var rows = results.map(function(item, index) {
					return E('tr', {}, [
						E('td', {}, String(index + 1)),
						E('td', { 'style': 'word-break:break-all' }, targets[index]),
						E('td', {}, (Number(item.speed_download || 0) * 8 / 1000000).toFixed(2) + ' Mbps'),
						E('td', {}, String(item.http_code || 0)),
						E('td', {}, (Number(item.time_starttransfer || 0) * 1000).toFixed(1) + ' ms')
					]);
				});
				var mbps = elapsed > 0 ? bytes * 8 / elapsed / 1000000 : 0;
				result.innerHTML = '';
				result.appendChild(E('div', { 'class': 'cbi-section' }, [
					E('h3', {}, _('Five Node Aggregated Result')),
					E('p', { 'style': 'font-size:1.35em;font-weight:bold' }, mbps.toFixed(2) + ' Mbps (' + (mbps / 8).toFixed(2) + ' MB/s)'),
					E('p', {}, _('Total Downloaded: ') + (bytes / 1048576).toFixed(2) + ' MiB'),
					E('table', { 'class': 'table' }, [
						E('tr', { 'class': 'tr table-titles' }, [ E('th', {}, '#'), E('th', {}, _('Node')), E('th', {}, _('Speed')), E('th', {}, 'HTTP'), E('th', {}, 'TTFB') ])
					].concat(rows))
				]));
			}).catch(function(err) {
				if (runId === activeRun) setStatus(_('Concurrent Test failed: ') + String(err.message || err), 'error');
			});
		}

		function runUpload() {
			var runId = ++activeRun;
			if (!validNumber(duration, 3, 86400) || !validNumber(maxMb, 0, Number.MAX_SAFE_INTEGER)) {
				setStatus(_('Please check test duration and max traffic per direction.'), 'error');
				return;
			}
			if (!confirmLongTest(_('Five-way Concurrent Upload'))) return;
			setStatus(_('Three-Way Upload Test in progress, click "Stop Immediately" at any time...'), 'notice');
			runJob('linkspeed-upload-multi', [ duration.value, maxMb.value, activeUploadUrl(), '3' ]).then(function(res) {
				if (runId !== activeRun) return;
				var results = (res.stdout || '').trim().split(/\n+/).map(parseMetrics);
				var bytes = results.reduce(function(sum, item) { return sum + Number(item.size_download || 0); }, 0);
				var elapsed = results.reduce(function(max, item) { return Math.max(max, Number(item.time_total || 0)); }, 0);
				var mbps = elapsed > 0 ? bytes * 8 / elapsed / 1000000 : 0;
				var rows = results.map(function(item, index) {
					return E('tr', {}, [
						E('td', {}, String(index + 1)),
						E('td', {}, (Number(item.speed_download || 0) * 8 / 1000000).toFixed(2) + ' Mbps'),
						E('td', {}, item.http_code ? String(item.http_code) : _('Time limit ended')),
						E('td', {}, (Number(item.time_total || 0)).toFixed(2) + ' s')
					]);
				});
				result.innerHTML = '';
				result.appendChild(E('div', { 'class': 'cbi-section' }, [
					E('h3', {}, _('Three-Way Upload Result')),
					E('p', { 'style': 'font-size:1.35em;font-weight:bold' }, mbps.toFixed(2) + ' Mbps (' + (mbps / 8).toFixed(2) + ' MB/s)'),
					E('p', {}, _('Total Uploaded: ') + (bytes / 1048576).toFixed(2) + ' MiB　' + _('Receiving endpoint: Nanjing University')),
					E('table', { 'class': 'table' }, [
						E('tr', { 'class': 'tr table-titles' }, [ E('th', {}, '#'), E('th', {}, _('Speed')), E('th', {}, 'HTTP'), E('th', {}, _('Time used')) ])
					].concat(rows))
				]));
			}).catch(function(err) {
				if (runId === activeRun) setStatus(_('Upload Test failed: ') + String(err.message || err), 'error');
			});
		}

		function runDuplex() {
			var runId = ++activeRun;
			var num = Number(concurrency.value) || 5; var targets = activeUrls().slice(0, num);
			if (targets.length < 2 || !validNumber(duration, 3, 86400) || !validNumber(maxMb, 0, Number.MAX_SAFE_INTEGER)) {
				setStatus(_('Invalid number of nodes or Test Parameters.'), 'error');
				return;
			}
			if (!confirmLongTest(_('Simultaneous Up/Down Test'))) return;
			setStatus(_('Simultaneous Up/Down Test in progress (5 downloads + 3 uploads)...'), 'notice');
			runJob('linkspeed-duplex', [ duration.value, maxMb.value, activeUploadUrl() ].concat(targets)).then(function(res) {
				if (runId !== activeRun) return;
				var down = [], up = [];
				(res.stdout || '').trim().split(/\n+/).forEach(function(line) {
					if (line.indexOf('D|') === 0) down.push(parseMetrics(line.substring(2)));
					if (line.indexOf('U|') === 0) up.push(parseMetrics(line.substring(2)));
				});
				if (!down.length || !up.length) throw new Error(_('Incomplete data returned by bidirectional test'));
				var downBytes = down.reduce(function(sum, item) { return sum + Number(item.size_download || 0); }, 0);
				var upBytes = up.reduce(function(sum, item) { return sum + Number(item.size_download || 0); }, 0);
				var downElapsed = down.reduce(function(max, item) { return Math.max(max, Number(item.time_total || 0)); }, 0);
				var upElapsed = up.reduce(function(max, item) { return Math.max(max, Number(item.time_total || 0)); }, 0);
				var downMbps = downElapsed > 0 ? downBytes * 8 / downElapsed / 1000000 : 0;
				var upMbps = upElapsed > 0 ? upBytes * 8 / upElapsed / 1000000 : 0;
				result.innerHTML = '';
				result.appendChild(E('div', { 'class': 'cbi-section' }, [
					E('h3', {}, _('Simultaneous Up/Down Test Result')),
					E('p', { 'style': 'font-size:1.35em;font-weight:bold' }, _('Download: ') + downMbps.toFixed(2) + ' Mbps'),
					E('p', { 'style': 'font-size:1.35em;font-weight:bold' }, _('Upload: ') + upMbps.toFixed(2) + ' Mbps'),
					E('p', {}, _('Downloaded: ') + (downBytes / 1048576).toFixed(2) + ' MiB　' + _('Uploaded: ') + (upBytes / 1048576).toFixed(2) + ' MiB'),
					E('p', {}, _('Simultaneous bidirectional testing reflects link capacity under full load, results are usually lower than separate tests.'))
				]));
			}).catch(function(err) {
				if (runId === activeRun) setStatus(_('Bidirectional Test failed: ') + String(err.message || err), 'error');
			});
		}

		function stopTest() {
			activeRun++;
			setStatus(_('Stopping speed test...'), 'warning');
			fs.exec('/usr/libexec/linkspeed-stop', []).then(function() {
				setStatus(_('Speed test stopped, all connections closed.'), 'warning');
			}).catch(function(err) {
				setStatus(_('Stop failed: ') + String(err.message || err), 'error');
			});
		}

		function loadHistory() {
			historyResult.textContent = _('Reading history...');
			fs.exec('/usr/libexec/linkspeed-history', [ 'list' ]).then(function(res) {
				var lines = String(res.stdout || '').trim().split(/\n+/).filter(Boolean);
				var rows = lines.map(function(line) {
					var f = line.split('|'), id = f[1], started = Number(f[3]), ended = Number(f[4]);
					return E('tr', {}, [ E('td', {}, new Date(started * 1000).toLocaleString()), E('td', {}, f[2]),
						E('td', {}, Math.max(0, ended - started) + _(' seconds')), E('td', {}, f[6] || '0'),
						E('td', {}, E('button', { 'class': 'btn cbi-button-action', 'click': function() { viewHistory(id); } }, _('View points'))) ]);
				});
				historyResult.innerHTML = '';
				historyResult.appendChild(lines.length ? E('table', { 'class': 'table' }, [ E('tr', { 'class': 'tr table-titles' }, [
					E('th', {}, _('Start time')), E('th', {}, _('Mode')), E('th', {}, _('Duration')), E('th', {}, _('Sampling points')), E('th', {}, '')
				]) ].concat(rows)) : E('p', {}, _('No Speed Test History yet.')));
			}).catch(function(err) { historyResult.textContent = _('Failed to read history: ') + String(err.message || err); });
		}

		function viewHistory(jobId) {
			historyResult.textContent = _('Reading per-second data...');
			fs.exec('/usr/libexec/linkspeed-history', [ 'detail', jobId ]).then(function(res) {
				var points = String(res.stdout || '').trim().split(/\n+/).filter(function(line) { return line.indexOf('S|') === 0; }).map(function(line) {
					var f = line.split('|'), dt = Math.max(Number(f[2]) || 1, 1);
					return { time: Number(f[1]), down: Number(f[3]) * 8 / dt / 1000000, up: Number(f[4]) * 8 / dt / 1000000 };
				});
				if (!points.length) throw new Error(_('This record has no Speed Sampling points'));
				var peakDown = 0, peakUp = 0, sumDown = 0, sumUp = 0;
				points.forEach(function(p) { peakDown = Math.max(peakDown, p.down); peakUp = Math.max(peakUp, p.up); sumDown += p.down; sumUp += p.up; });
				var canvas = E('canvas', { 'width': '900', 'height': '320', 'style': 'width:100%;max-width:1000px;height:320px;background:#202020;border-radius:4px;cursor:crosshair' });
				var pointInfo = E('p', { 'style': 'min-height:1.5em;font-weight:bold;color:#ddd' }, _('Click the curve to view actual data for a specific second.'));
				historyResult.innerHTML = '';
				historyResult.appendChild(E('div', {}, [
					E('p', { 'style': 'font-size:1.15em;font-weight:bold' }, _('Average Download: ') + (sumDown / points.length).toFixed(2) + ' Mbps　' + _('Average Upload: ') + (sumUp / points.length).toFixed(2) + ' Mbps'),
					E('p', {}, _('Peak Download: ') + peakDown.toFixed(2) + ' Mbps　' + _('Peak Upload: ') + peakUp.toFixed(2) + ' Mbps　' + _('Sampling points:') + points.length),
					canvas, pointInfo,
					E('p', { 'class': 'cbi-value-description' }, _('Purple: Download Cyan: Upload Each original point is a one-second sample; long records are automatically sampled when plotting.'))
				]));
				var ctx = canvas.getContext('2d'), w = canvas.width, h = canvas.height, pad = 34;
				var max = Math.max(10, peakDown, peakUp) * 1.1, step = Math.max(1, Math.ceil(points.length / 1200)), drawn = [];
				for (var i = 0; i < points.length; i += step) {
					var end = Math.min(i + step, points.length), d = 0, u = 0;
					for (var j = i; j < end; j++) { d += points[j].down; u += points[j].up; }
					drawn.push({ down: d / (end - i), up: u / (end - i) });
				}
				ctx.strokeStyle = '#444'; ctx.lineWidth = 1;
				for (var g = 0; g <= 4; g++) { var y = pad + (h - pad * 2) * g / 4; ctx.beginPath(); ctx.moveTo(pad, y); ctx.lineTo(w - pad, y); ctx.stroke(); }
				function draw(key, color) { ctx.beginPath(); ctx.strokeStyle = color; ctx.lineWidth = 2; drawn.forEach(function(p, n) { var x = pad + (drawn.length > 1 ? n * (w - pad * 2) / (drawn.length - 1) : 0), y = h - pad - p[key] / max * (h - pad * 2); if (n) ctx.lineTo(x, y); else ctx.moveTo(x, y); }); ctx.stroke(); }
				draw('down', '#9b87f5'); draw('up', '#58d5d2');
				ctx.fillStyle = '#ddd'; ctx.font = '13px sans-serif'; ctx.fillText(max.toFixed(0) + ' Mbps', 4, pad); ctx.fillText('0', 18, h - pad); ctx.fillText(new Date(points[0].time * 1000).toLocaleTimeString(), pad, h - 8); ctx.fillText(new Date(points[points.length - 1].time * 1000).toLocaleTimeString(), w - 105, h - 8);
				var baseChart = ctx.getImageData(0, 0, w, h);
				canvas.addEventListener('click', function(ev) {
					var rect = canvas.getBoundingClientRect();
					var ratio = Math.max(0, Math.min(1, (ev.clientX - rect.left) / rect.width));
					var index = Math.round(ratio * (points.length - 1));
					var p = points[index];
					var x = pad + ratio * (w - pad * 2);
					var downY = h - pad - p.down / max * (h - pad * 2);
					var upY = h - pad - p.up / max * (h - pad * 2);
					ctx.putImageData(baseChart, 0, 0);
					ctx.strokeStyle = '#eee'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(x, pad); ctx.lineTo(x, h - pad); ctx.stroke();
					function marker(y, color) { ctx.fillStyle = color; ctx.beginPath(); ctx.arc(x, y, 5, 0, Math.PI * 2); ctx.fill(); ctx.strokeStyle = '#fff'; ctx.stroke(); }
					marker(downY, '#9b87f5'); marker(upY, '#58d5d2');
					pointInfo.textContent = new Date(p.time * 1000).toLocaleString() + '　' + _('Download: ') + p.down.toFixed(2) + ' Mbps　' + _('Upload: ') + p.up.toFixed(2) + ' Mbps';
				});
			}).catch(function(err) { historyResult.textContent = _('Failed to read history: ') + String(err.message || err); });
		}

		function loadHistory() {
			fs.exec('/usr/libexec/linkspeed-history', [ 'list' ]).then(function(res) {
				var rows = String(res.stdout || '').trim().split(/\n+/).filter(Boolean).map(function(line) {
					var f = line.split('|'), jobId = f[1];
					return E('tr', {}, [ E('td', {}, new Date(Number(f[3]) * 1000).toLocaleString()),
						E('td', {}, f[2]), E('td', {}, f[6] || '0'),
						E('td', {}, E('button', { 'class': 'btn cbi-button-action', 'click': function() { viewHistory(jobId); } }, _('View points'))) ]);
				});
				historyResult.innerHTML = '';
				historyResult.appendChild(E('table', { 'class': 'table' }, [ E('tr', { 'class': 'tr table-titles' }, [
					E('th', {}, _('Start time')), E('th', {}, _('Mode')), E('th', {}, _('Sampling points')), E('th', {}, _('Action'))
				]) ].concat(rows)));
			}).catch(function(err) { historyResult.textContent = _('Failed to read history: ') + String(err.message || err); });
		}

		return E([], [
			E('h2', {}, _('Network Speed Test')),
			E('div', { 'class': 'cbi-map-descr' }, _('Real-time speed test tool without installing an app. Test traffic is generated by the router WAN port.')),
			E('div', { 'class': 'cbi-section' }, [
				E('h3', {}, _('Test Parameters')),
				E('div', { 'class': 'cbi-value' }, [ E('label', { 'class': 'cbi-value-title' }, _('Node Group')), E('div', { 'class': 'cbi-value-field' }, profile) ]),
				E('div', { 'class': 'cbi-value' }, [ E('label', { 'class': 'cbi-value-title' }, _('Single Node Selection')), E('div', { 'class': 'cbi-value-field' }, selected) ]),
				E('div', { 'class': 'cbi-value' }, [ E('label', { 'class': 'cbi-value-title' }, _('Custom Temporary Link')), E('div', { 'class': 'cbi-value-field' }, custom) ]),
				E('div', { 'class': 'cbi-value' }, [ E('label', { 'class': 'cbi-value-title' }, _('Custom Test URLs')), E('div', { 'class': 'cbi-value-field' }, [ customUrlsInput, E('div', { 'class': 'cbi-value-description' }, _('Enter one URL per line. These will be added to the test dropdown.')) ]) ]),
				E('div', { 'class': 'cbi-value' }, [ E('label', { 'class': 'cbi-value-title' }, _('WAN Interface')), E('div', { 'class': 'cbi-value-field' }, ifaceInput) ]),
				E('div', { 'class': 'cbi-value' }, [ E('label', { 'class': 'cbi-value-title' }, _('Max Duration (seconds)')), E('div', { 'class': 'cbi-value-field' }, duration) ]),
				E('div', { 'class': 'cbi-value' }, [ E('label', { 'class': 'cbi-value-title' }, _('Max Traffic per Direction (MB)')), E('div', { 'class': 'cbi-value-field' }, [ maxMb, maxMbHint ]) ]),
				E('div', { 'class': 'cbi-value' }, [ E('label', { 'class': 'cbi-value-title' }, _('Ping Count')), E('div', { 'class': 'cbi-value-field' }, [ pingCount, E('div', { 'class': 'cbi-value-description' }, _('Number of packets to send for Ping/Jitter test.')) ]) ]),
				E('div', { 'class': 'cbi-value' }, [ E('label', { 'class': 'cbi-value-title' }, _('Concurrent Connections')), E('div', { 'class': 'cbi-value-field' }, [ concurrency, E('div', { 'class': 'cbi-value-description' }, _('Number of parallel streams for the Concurrent Test (2-10).')) ]) ]),
				E('div', { 'class': 'cbi-value' }, [ E('label', { 'class': 'cbi-value-title' }, _('History Retention (times)')), E('div', { 'class': 'cbi-value-field' }, [ historyLimit, E('div', { 'class': 'cbi-value-description' }, _('Each complete speed test counts as one record, range 1-200; written to disk all at once upon completion.')) ]) ]),
				E('div', { 'class': 'cbi-page-actions' }, [
					E('button', { 'class': 'btn cbi-button-neutral', 'click': runPing }, _('Ping / Jitter Test')), ' ',
					E('button', { 'class': 'btn cbi-button-action', 'click': runSingle }, _('Single Node Test')),
					' ', E('button', { 'class': 'btn cbi-button-positive', 'click': runMulti }, _('Five Node Concurrent Test')),
					' ', E('button', { 'class': 'btn cbi-button-action', 'click': runUpload }, _('Three-Way Upload Test')),
					' ', E('button', { 'class': 'btn cbi-button-positive', 'click': runDuplex }, _('Simultaneous Up/Down Test')),
					' ', E('button', { 'class': 'btn cbi-button-negative', 'click': stopTest }, _('Stop Immediately'))
				])
			]),
			result,
			E('div', { 'class': 'cbi-section', 'id': 'linkspeed-ping-section', 'style': 'display: none;' }),
			E('div', { 'class': 'cbi-section' }, [ E('h3', {}, _('Speed Test History')), E('button', { 'class': 'btn cbi-button-action', 'click': loadHistory }, _('Refresh History')), historyResult ])
		]);
	}
});
