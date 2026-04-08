"use client"

export default function SpeedLoader() {
  return (
    <div className="speedLoaderWrap" aria-label="Loading" role="status">
      <div className="speedLoader">
        <span>
          <span />
          <span />
          <span />
          <span />
        </span>
        <div className="speedLoaderBase">
          <span />
          <div className="speedLoaderFace" />
        </div>
      </div>
      <div className="speedLoaderLongfazers">
        <span />
        <span />
        <span />
        <span />
      </div>
    </div>
  )
}
