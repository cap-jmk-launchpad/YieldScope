import React from "react";
import { Composition } from "remotion";
import { ScatteredLedger } from "./compositions/ScatteredLedger";
import { SourceWeave } from "./compositions/SourceWeave";
import { theme } from "./theme";

export const RemotionRoot: React.FC = () => {
  return (
    <>
      <Composition
        id="ScatteredLedger"
        component={ScatteredLedger}
        durationInFrames={theme.video.durationInFrames}
        fps={theme.video.fps}
        width={theme.video.width}
        height={theme.video.height}
      />
      <Composition
        id="SourceWeave"
        component={SourceWeave}
        durationInFrames={theme.video.durationInFrames}
        fps={theme.video.fps}
        width={theme.video.width}
        height={theme.video.height}
      />
    </>
  );
};
