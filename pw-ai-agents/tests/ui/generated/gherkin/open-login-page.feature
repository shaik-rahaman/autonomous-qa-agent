Feature: CRM Login
  Scenario: Successful login to CRM
    Given the user opens the login page
    When the user enters the username "demosalesmanager"
    And the user enters the password "crmsfa"
    And the user clicks the login button
    Then the CRM link should appear