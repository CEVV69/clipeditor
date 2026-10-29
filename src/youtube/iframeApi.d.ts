export {}

declare global {
  namespace YT {
    enum PlayerState {
      ENDED = 0,
      PLAYING = 1,
      PAUSED = 2,
    }

    interface OnStateChangeEvent {
      data: PlayerState
      target: Player
    }

    interface OnErrorEvent {
      data: number
      target: Player
    }

    interface PlayerVars {
      autoplay?: 0 | 1
      controls?: 0 | 1
      disablekb?: 0 | 1
      fs?: 0 | 1
      modestbranding?: 0 | 1
      rel?: 0 | 1
      iv_load_policy?: 1 | 3
      playsinline?: 0 | 1
    }

    interface PlayerOptions {
      videoId: string
      width?: string | number
      height?: string | number
      playerVars?: PlayerVars
      events?: {
        onReady?: (event: { target: Player }) => void
        onStateChange?: (event: OnStateChangeEvent) => void
        onError?: (event: OnErrorEvent) => void
      }
    }

    class Player {
      constructor(element: HTMLElement | string, options: PlayerOptions)
      playVideo(): void
      pauseVideo(): void
      getDuration(): number
      getCurrentTime(): number
      getVideoData(): { title: string }
      destroy(): void
    }
  }

  interface Window {
    YT?: typeof YT
    onYouTubeIframeAPIReady?: () => void
  }
}
