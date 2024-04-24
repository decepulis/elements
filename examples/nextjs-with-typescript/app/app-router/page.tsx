import MuxUploader, { MuxUploaderDrop, MuxUploaderFileSelect, MuxUploaderProgress, MuxUploaderRetry, MuxUploaderStatus } from '@mux/mux-uploader-react';
import MuxVideo from "@mux/mux-video-react";
import MuxPlayer from "@mux/mux-player-react";
import MuxPlayerLazy from "@mux/mux-player-react/lazy";
import "@mux/mux-player/themes/classic";
import "@mux/mux-player/themes/microvideo";
import muxBlurUp from '@mux/blurup'
import { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'App Directory test'
}
export default async function Page() {
  // because this is a server component, we can run muxBlurUp
  const playbackId = "OG6Zq19uOjRkjO3bISLWasE2M01Cx8O3o"
  const { blurDataURL, aspectRatio } = await muxBlurUp(playbackId)
  return (
    <main>
      <p>Mux Uploader React, Mux Video React, and Mux Player React all natively support client components.</p>
      <h2>Mux Uploader</h2>
      <MuxUploaderDrop muxUploader="uploader" overlay overlayText="You're doing great!">
          <h2>Enter your upload GCS url:</h2>

          <input type="text" style={{
            marginBottom: "20px",
            width: "min(100%, 400px)",
            boxSizing: "border-box"
          }} placeholder="https://storage.googleapis.com/..." />

          <MuxUploader
            style={{ display: "none", height: "200px" }}
            className="foo"
            id="uploader"
            noDrop
            noProgress
            noStatus
            noRetry
          />
        </MuxUploaderDrop>
        <MuxUploaderFileSelect muxUploader="uploader" ></MuxUploaderFileSelect>
        <MuxUploaderProgress muxUploader="uploader" >What should be here?</MuxUploaderProgress>
        <MuxUploaderRetry muxUploader="uploader" ></MuxUploaderRetry>
        <MuxUploaderStatus muxUploader="uploader" ></MuxUploaderStatus>
      <h2>Mux Video</h2>
      <MuxVideo
        playbackId={playbackId}
        style={{ width: '100%' }}
      />
      <h2>Mux Player</h2>
      <p>Standard import, with the classic theme</p>
      <MuxPlayer
        playbackId={playbackId}
        placeholder={blurDataURL}
        theme="classic"
        style={{ width: '100%', aspectRatio }}
      />
      <p>Lazy import, with the microvideo theme</p>
      <MuxPlayerLazy
        playbackId={playbackId}
        placeholder={blurDataURL}
        theme="microvideo"
        style={{ width: '100%', aspectRatio }}
      />
    </main>
  )
}