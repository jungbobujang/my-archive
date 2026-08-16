// 서비스워커 등록. 운영 빌드에서만 붙인다 —
// 개발 중에는 캐시가 남아 방금 고친 코드가 안 보이는 사고가 나기 쉽다.
export function registerServiceWorker() {
  if (!import.meta.env.PROD) return
  if (!('serviceWorker' in navigator)) return

  window.addEventListener('load', () => {
    // 첫 방문이면 controller 가 없다. 이때의 controllerchange 는 정상 설치이므로 새로고침하지 않는다.
    const hadController = !!navigator.serviceWorker.controller
    let reloading = false

    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (!hadController || reloading) return
      reloading = true
      window.location.reload()
    })

    navigator.serviceWorker.register('/sw.js').catch((err) => {
      console.error('서비스워커 등록 실패', err)
    })
  })
}
