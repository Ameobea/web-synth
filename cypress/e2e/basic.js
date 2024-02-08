context('Entrypoint', () => {
  it('The app should load and be visible', () => {
    cy.visit('http://localhost:9000');

    cy.get('.vc-switcher-tab-title').contains('Graph Editor').click();

    cy.get('canvas.graph-editor').should('be.visible');
  });

  it('Should render composition 43 without errors', () => {
    cy.visit('http://localhost:9000/composition/43');

    cy.get('.control-panel-midi-keyboard').should('contain.text', 'midi keyboard 1');
  });

  it('Should render composition 46 without errors', () => {
    cy.visit('http://localhost:9000/composition/46');

    cy.get('.control-panel-midi-keyboard').should('contain.text', 'midi keyboard 1');

    cy.get('.control-panel-setting-label').should('contain.text', 'volume');
    cy.get('.control-panel-setting-label').should('contain.text', 'wavetable fm');
    cy.get('.control-panel-setting-label').should('contain.text', 'order 2 wtable fm');
    cy.get('.control-panel-setting-label').should('contain.text', 'lfo len samples');
    cy.get('.control-panel-setting-label').should('contain.text', 'reverb room size');

    cy.get('.vc-switcher-tab-title').contains('Graph Editor').click();
    cy.get('canvas.graph-editor').should('be.visible');

    cy.get('.vc-switcher-tab-title').contains('Synth Designer').click();
    // div.operator-square.output-weight[data-operator-ix="1"] should exist, have `data-selected` set to true, and contain the text `0.24`
    cy.get('div.operator-square.output-weight[data-operator-ix="1"]')
      .should('have.attr', 'data-selected', 'true')
      .and('contain.text', '0.24');
  });

  it('Should render the standalone FM synth demo without errors', () => {
    cy.visit('http://localhost:9000/fm.html');

    cy.get('.ReactPiano__Keyboard').should('exist');
  });
});
