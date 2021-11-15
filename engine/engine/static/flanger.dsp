// Author: Julius Smith
// License: MIT

ma = library("maths.lib");
ba = library("basics.lib");
de = library("delays.lib");
si = library("signals.lib");
an = library("analyzers.lib");
fi = library("filters.lib");
os = library("oscillators.lib");
no = library("noises.lib");
ef = library("misceffects.lib");
co = library("compressors.lib");
ve = library("vaeffects.lib");
pf = library("phaflangers.lib");
re = library("reverbs.lib");
en = library("envelopes.lib");

flanger_demo = ba.bypass2(fbp,flanger_stereo_demo)
with{
	fbp = checkbox("[0] Bypass	[tooltip: When this is checked, the flanger
		has no effect]");
	invert = checkbox("[1] Invert Flange Sum");

	flanger_stereo_demo(x,y) = x,y :
		*(level),*(level) : pf.flanger_stereo(dmax,curdel1,curdel2,depth,fb,invert);

	lfol = os.oscrs;
	lfor = os.oscrc;

	dmax = 2048;
	dflange = 0.001 * ma.SR *
		hslider("Flange Delay", 10, 0, 20, 0.001);
	odflange = 0.001 * ma.SR *
	hslider("[2] Delay Offset", 1, 0, 20, 0.001);
	freq   = hslider("Speed", 0.5, 0, 10, 0.01);
	depth  = hslider("[2] Depth [style:knob]", 0.45, 0, 1, 0.001);
	fb     = hslider("[3] Feedback [style:knob]", 0, -0.999, 0.999, 0.001);
	level  = hslider("Flanger Output Level [unit:dB]", 0, -60, 10, 0.1) :
		ba.db2linear;
	curdel1 = odflange+dflange*(1 + lfol(freq))/2;
	curdel2 = odflange+dflange*(1 + lfor(freq))/2;
};

process = flanger_demo;
