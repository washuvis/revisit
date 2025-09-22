//import * as d3 from 'd3';

import { useNextStep } from '../../../store/hooks/useNextStep';
import { useEffect, useState } from 'react';
import { useChartDimensions } from './hooks/useChartDimensions';

const chartSettings = {
  marginBottom: 40,
  marginLeft: 40,
  marginTop: 15,
  marginRight: 15,
  width: 400,
  height: 400,
};

var timeDefault = false;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function Conversation({ parameters }: { parameters: any }) {
  const [ref, dms] = useChartDimensions(chartSettings);

  const [timeUp, setTimeUp] = useState(timeDefault);

  useEffect(() => {
    const timer = setTimeout(() => {
      timeDefault = true;
      setTimeUp(true);
      useNextStep();
    }, 10000); // 10 seconds

    return () => clearTimeout(timer);
  }, []);



  return (
    <div className="Chart__wrapper" ref={ref} style={{ height: 400 }}>
      {timeUp ? (
        <div id="timeout">
          <h2>Time is up! Please click Next.</h2>
        </div>
      ) : (
        <img alt='stimulus' style={{ width: 100 }} src={'./logo.png'} />
      )}
    </div>
  );
}

export default Conversation;
