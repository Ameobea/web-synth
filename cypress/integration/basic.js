context('Entrypoint', () => {
  it('The app should load and be visible', () => {
    cy.visit('http://localhost:9000');

    cy.get('canvas.graph-editor').should('be.visible');
  });

  it('Should render composition 43 without errors', () => {
    cy.visit('http://localhost:9000/composition/43');

    cy.get('.control-panel-midi-keyboard').should('contain.text', 'midi keyboard 1');
  });
});
