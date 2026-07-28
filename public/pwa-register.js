if ('serviceWorker' in navigator && (
  location.protocol === 'https:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1'
)) {
  addEventListener('load', () => navigator.serviceWorker.register('/service-worker.js'))
}
