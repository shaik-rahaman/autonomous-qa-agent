Feature: Login to CRM
  Scenario: Successful login to CRM
    Given the user navigates to http://leaftaps.com/opentaps/control/main
    When the user enters username "demosalesmanager"
    And enters password "crmsfa"
    And clicks the login button
    Then the CRM link should be visible