(() => {
  const nativeSetInterval = window.setInterval.bind(window);
  const nativeSetTimeout = window.setTimeout.bind(window);

  // Two legacy initialization loops repeatedly rebuild the same result DOM for
  // several seconds. Replace only those known loops with a small number of
  // settling passes, then restore the native timer implementation after load.
  window.setInterval = function patchedSetInterval(handler, timeout, ...args) {
    const source = typeof handler === 'function' ? Function.prototype.toString.call(handler) : '';

    if (source.includes('renderSplitDetails') && source.includes('attempts >= 24')) {
      return nativeSetTimeout(() => handler(...args), 60);
    }

    if (source.includes('queueNormalizeTables') && source.includes('attempts >= 20')) {
      const first = nativeSetTimeout(() => handler(...args), 80);
      nativeSetTimeout(() => handler(...args), 260);
      return first;
    }

    return nativeSetInterval(handler, timeout, ...args);
  };

  window.addEventListener('load', () => {
    nativeSetTimeout(() => {
      window.setInterval = nativeSetInterval;
    }, 0);
  }, { once: true });
})();
