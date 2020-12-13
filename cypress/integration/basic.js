context('Entrypoint', () => {
  it('The app should load and be visible', () => {
    cy.visit('http://localhost:9000');

    cy.get('canvas.graph-editor').should('be.visible');
  });

  it('Should render the functional synth designer', () => {
    cy.get('span.vc-switcher-tab-title').contains('Synth Designer').click();
    cy.get('button').contains('add synth module').click();
    cy.scrollTo(0);
    cy.get('svg.adsr-viz').should('be.visible');
  });

  it('Should render the functional MIDI Editor', () => {
    cy.get('span.vc-switcher-tab-title').contains('MIDI Editor').click();
    cy.get('svg#foreground-svg').should('be.visible');
  });
});
