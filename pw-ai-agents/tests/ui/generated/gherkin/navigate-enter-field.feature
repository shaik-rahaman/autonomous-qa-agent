Feature: Login to CRM

  Scenario: Successful login and CRM link visibility
    Given navigate to http://leaftaps.com/opentaps/control/main
    When enter username demosalesmanager in the username field
    And enter password crmsfa in the password field
    And click the Login button
    Then verify the CRM link is visible