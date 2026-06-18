Feature: OrangeHRM Login

  Scenario: Valid employee logs in and accesses dashboard
    Given the employee is on the OrangeHRM login page
    When the employee enters valid credentials
    And clicks the login button
    Then the employee should be redirected to the dashboard
    And the dashboard should load successfully