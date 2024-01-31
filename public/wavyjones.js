// Taken/Adapted from https://github.com/stuartmemo/wavy-jones

const delay = delayMs => new Promise(resolve => setTimeout(resolve, delayMs));

const retryAsync = async (
  fn, //: () => Promise<T>,
  attempts,
  delayMs
) => {
  for (let i = 0; i < attempts; i++) {
    try {
      const res = await fn();
      return res;
    } catch (err) {
      if (i === attempts - 1) {
        // Out of attempts
        throw err;
      }

      await delay(delayMs);
    }
  }
  throw new UnreachableError();
};

window.WavyJones = function (context, elem, width, height) {
  var analyser = context.createAnalyser();

  analyser.width = width;
  analyser.height = height;
  analyser.lineColor = 'yellow';
  analyser.lineThickness = 5;

  var svgNamespace = 'http://www.w3.org/2000/svg';
  var paper = document.createElementNS(svgNamespace, 'svg');
  paper.setAttribute('width', analyser.width);
  paper.setAttribute('height', analyser.height);
  paper.setAttributeNS(
    'http://www.w3.org/2000/xmlns/',
    'xmlns:xlink',
    'http://www.w3.org/1999/xlink'
  );

  retryAsync(
    async () => {
      const elem_ = document.getElementById(elem);
      if (!elem) {
        throw new Error();
      }
      return elem_;
    },
    30,
    50
  ).then(elem => {
    if (!elem) {
      return;
    }

    elem.appendChild(paper);

    var oscLine = document.createElementNS(svgNamespace, 'path');
    oscLine.setAttribute('stroke', analyser.lineColor);
    oscLine.setAttribute('stroke-width', analyser.lineThickness);
    oscLine.setAttribute('fill', 'none');
    paper.appendChild(oscLine);

    var noDataPoints = 10,
      freqData = new Uint8Array(analyser.frequencyBinCount);

    var drawLine = function () {
      if (analyser.isPaused) {
        analyser.animationFrameHandle = requestAnimationFrame(drawLine);
        return;
      }

      analyser.getByteTimeDomainData(freqData);

      var graphPoints = [],
        graphStr = '';

      graphPoints.push('M0, ' + analyser.height / 2);

      for (var i = 0; i < freqData.length; i++) {
        if (i % noDataPoints) {
          var point = (freqData[i] / 128) * (analyser.height / 2);
          graphPoints.push('L' + i + ', ' + point);
        }
      }

      for (i = 0; i < graphPoints.length; i++) {
        graphStr += graphPoints[i];
      }

      oscLine.setAttribute('stroke', analyser.lineColor);
      oscLine.setAttribute('stroke-width', analyser.lineThickness);

      oscLine.setAttribute('d', graphStr);

      analyser.animationFrameHandle = requestAnimationFrame(drawLine);
    };

    drawLine();
  });

  return analyser;
};
