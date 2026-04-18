Feature: User Login

  Scenario: Login to application and verify CRM link is visible
    Given the user is on the login page
    When the user enters valid credentials
    And clicks the login button
    Then the CRM link should be visible