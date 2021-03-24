// Taken/Adapted from https://github.com/stuartmemo/wavy-jones

window.WavyJones = function (context, elem, updateInterval, width, height) {
  var analyser = context.createAnalyser();
  var elem = document.getElementById(elem);
  if (!elem) {
    return;
  }

  analyser.width = elem.offsetWidth || width;
  analyser.height = elem.offsetHeight || height;
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
  elem.appendChild(paper);

  var oscLine = document.createElementNS(svgNamespace, 'path');
  oscLine.setAttribute('stroke', analyser.lineColor);
  oscLine.setAttribute('stroke-width', analyser.lineThickness);
  oscLine.setAttribute('fill', 'none');
  paper.appendChild(oscLine);

  var noDataPoints = 10,
    freqData = new Uint8Array(analyser.frequencyBinCount);

  var drawLine = function () {
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

  return analyser;
};
