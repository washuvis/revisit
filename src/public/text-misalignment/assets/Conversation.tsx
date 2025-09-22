import { useEffect, useState } from 'react';
import { useNextStep } from '../../../store/hooks/useNextStep';
import { useChartDimensions } from './hooks/useChartDimensions';

const chartSettings = {
  marginBottom: 40,
  marginLeft: 40,
  marginTop: 15,
  marginRight: 15,
  width: 400,
  height: 400,
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function Conversation({ parameters }: { parameters: any }) {
  const { goToNextStep } = useNextStep();
  const ret = useChartDimensions(chartSettings);
  const ref = ret[0];
  const [timeUp, setTimeUp] = useState(false);
  const path = './logo.png'

  useEffect(() => {
    const timer = setTimeout(() => {
      setTimeUp(true);
      goToNextStep();
    }, parameters.waitSeconds * 1000);

    return () => clearTimeout(timer);
  }, []);

  return (
    <div className="Chart__wrapper" ref={ref} style={{ height: 400 }}>
      {timeUp ? (
        <div id="timeout">
          <h2>Time is up! Please click Next.</h2>
        </div>
      ) : (
        <img alt="stimulus" style={{ width: 100 }} src={String(path)} />
      )}
    </div>
  );
}

export default Conversation;
