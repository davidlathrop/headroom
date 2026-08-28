import "./index.css";
import { Composition } from "remotion";
import { HeadroomDemo, TOTAL_FRAMES, FPS } from "./HeadroomDemo";

export const RemotionRoot: React.FC = () => {
  return (
    <Composition
      id="HeadroomDemo"
      component={HeadroomDemo}
      durationInFrames={TOTAL_FRAMES}
      fps={FPS}
      width={1920}
      height={1080}
    />
  );
};
