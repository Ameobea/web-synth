# composition-sharing

**Composition Sharing** is a module that is used to share and load compositions with other users.

![A screenshot of the composition sharing menu from web synth.  It shows a collection of three buttons labeled "Save as New Composition", "Load Composition", and "Save as Subgraph".](https://i.ameo.link/crg.png)

Clicking "Load Composition" will give you a list of compositions from other users you can load and try out for yourself.  _Note that this will overwrite your current composition, so save/share your project before loading another one!_

## composition versioning

If you are logged in (using the menu which is accessible via the top-most button on the right side of the screen), then you can save new versions of your existing compositions.  If editing a loaded composition, there will be a new "Save as New Version" button available in the composition sharing screen.

When loading a composition either via the composition sharing menu, the most recent version will be loaded.  When loading compositions via URL, the most recent version will be opened if the ID in the URL corresponds to the _initial version_ of the composition.  Intermediate versions can be loaded by providing their version ID, which are listed in the load composition menu of composition sharing.
