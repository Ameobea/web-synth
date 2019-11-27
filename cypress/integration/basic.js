context('Entrypoint', () => {
  it('The app should load and be visible', () => {
    cy.visit('http://localhost:9000');

    cy.get('div.ace_content').should('be.visible');
  });
});
