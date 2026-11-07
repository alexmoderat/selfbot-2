// Timeouts ueber die 24,8-Tage-Grenze von setTimeout hinaus (Supibots long-timeout)

const MAX_TIMEOUT = 2147483647;

class LongTimeout {
	/**
	 * @param {() => unknown} callback
	 * @param {number} time Verzoegerung oder Zeitstempel
	 * @param {boolean} [useTimestamp] time ist ein Zeitstempel statt einer Verzoegerung
	 */
	constructor(callback, time, useTimestamp = false) {
		if (!Number.isFinite(time)) {
			throw new Error('A finite number must be used for LongTimeout');
		}

		if (useTimestamp) {
			this.scheduleTime = new Date(time);
			time -= Date.now();
		}
		else {
			this.scheduleTime = new Date(Date.now() + time);
		}

		if (time < MAX_TIMEOUT) {
			this.timeout = setTimeout(callback, time);
		}
		else {
			this.timeout = setTimeout(() => {
				this.timeout = new LongTimeout(callback, time - MAX_TIMEOUT, false);
			}, MAX_TIMEOUT);
		}
	}

	clear() {
		let timeoutToClear = this.timeout;
		while (timeoutToClear instanceof LongTimeout) {
			timeoutToClear = timeoutToClear.timeout;
		}
		if (timeoutToClear) {
			clearTimeout(timeoutToClear);
		}
		this.timeout = null;
	}
}

module.exports = { LongTimeout };
