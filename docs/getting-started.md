# getting started guide

Web synth runs completely in the web browser, so no installation or other setup is required.  The full application is available online:

**<https://synth.ameo.dev/>**

After loading the application for the first time, you'll be greeted with the [[welcome-page]].

![A screenshot of the welcome page of web synth, shown when opening the application for the first time.  It includes some basic information about web synth, links to Github, Demo Video, and Docs, as well as four demo compositions with associated preview images and brief descriptions.](https://i.ameo.link/cr4.png)

I highly recommend checking out a couple of the demo compositions shown under the **Demos** section.  They provide a nice overview of the high-level features of web synth and show off the kinds of patches you can build with it.

At any time, you can reset web synth back to its default patch by clicking the red X icon in the top right of the screen:

![A screenshot of the web synth UI showing the red X button in the top right used to reset the app back to its default state, called out with a yellow arrow](https://i.ameo.link/cr6.png)

## high-level architecture

Web synth's structure is tightly tied to the concept of the [[audio-graph]].  You can think of web synth as a bunch of nodes (also referred to as [[module]]s) that produce and/or consume sound or other signals which are connected together.

For this reason, the [[graph-editor]] is of central importance to web synth.

![A screenshot of the web synth graph editor, which contains a small patch with 7 nodes.  These nodes have names like MIDI Keyboard, MIDI Editor, Synth Designer, etc.  They are connected together with MIDI keyboard as an input and Destination (representing the audio output of the patch) as an output.](https://i.ameo.link/cr7.png)

Whenever a [[module]] is added to a composition, it will almost always need to be connected to some other module in order for it to do anything.  Any sound sent into the special **Destination** node will be output from your speakers/headphones.

## usage tips

Although web synth is mostly stable and usable, there are still bugs - especially in less well-trodden corners and older features.

If you ever run into an issue or crash, you can often work around it by simply refreshing the page.  Web synth will always save its state when closing its tab or refreshing, and it will load back exactly the same way when it's opened again.

Check out the [[composition-sharing]] module to browser a collection of patches and compositions from me and other users.  You can also use it to save your own compositions and generate a publicly available URL for them to send to others.

[//begin]: # "Autogenerated link references for markdown compatibility"
[audio-graph]: audio-graph "audio graph"
[module]: module "web synth modules"
[graph-editor]: graph-editor "graph editor"
[composition-sharing]: composition-sharing "composition-sharing"
[//end]: # "Autogenerated link references"
