export {}

declare global {
  class RestrictionTarget {
    static fromElement(element: Element): Promise<RestrictionTarget>
  }

  interface MediaStreamTrack {
    restrictTo?(target: RestrictionTarget): Promise<void>
  }
}
