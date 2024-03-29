# modulation index

The **modulation index** is a number that corresponds to how much an [[operator]] modulates the frequency of another operator.  There is some math that determines how the modulation index translates into an actual multiplier that is applied to the output of the modulating [[operator]] which is based off the frequency of the modulating operator.

In the [[modulation-matrix]], the cells in the middle show the modulation index of each possible operator to operator modulation.  For example, _this_ cell:

![](https://i.ameo.link/5f85de5073aa4015c94854ca7fee5937830ca475.png)

controls the modulation index of operator 2 -> operator 1.  In the example image, the modulation index changes over time according to the output of an [[envelope-generator]] that outputs values between 0 and 16.2.  That means that depending on the current state of the envelope generator, the modulation index of operator 2 -> operator 1 is somewhere between 0 and 16.2.

## feedback

Feedback is when an operator modulates itself directly or via a loop in the modulation graph somewhere further down.  Direct modulation occurs in cells marked with pink here:

![](https://i.ameo.link/fec7df8597e7ee73bfb2775e92a463a3f88cafc4.png)

This modulation matrix also exhibits feedback because operator 2 modulates operator 1 which in turn modulates operator 2 again:

![](https://i.ameo.link/37f2c9a3260d5d3032bb53dbe7e470e4fd2f6e34.png)

Feedback very quickly produces extremely harsh, loud, and noisy sounds, so it's advisable to be careful with it.

[//begin]: # "Autogenerated link references for markdown compatibility"
[operator]: operator "operator"
[modulation-matrix]: modulation-matrix "modulation matrix"
[envelope-generator]: envelope-generator "envelope generator"
[//end]: # "Autogenerated link references"
