Feature: User Login
  Scenario: Successful login
    Given the user is on the login page
    When the user enters username "demosalesmanager"
    And the user enters password "crmsfa"
    And clicks the login button
    Then the CRM link should appear