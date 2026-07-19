import React from "react";
import { Composition } from "remotion";
import { ScatteredLedger } from "./compositions/ScatteredLedger";
import { SourceWeave } from "./compositions/SourceWeave";
import { VIDEO } from "./tokens";

export const RemotionRoot: React.FC = () => {
  return (
    <>
      <Composition
        id="ScatteredLedger"
        component={ScatteredLedger}
        durationInFrames={VIDEO.durationInFrames}
        fps={VIDEO.fps}
        width={VIDEO.width}
        height={VIDEO.height}
      />
      <Composition
        id="SourceWeave"
        component={SourceWeave}
        durationInFrames={VIDEO.durationInFrames}
        fps={VIDEO.fps}
        width={VIDEO.width}
        height={VIDEO.height}
      />
    </>
  );
};
