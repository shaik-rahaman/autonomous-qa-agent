Feature: OrangeHRM Employee Login

  Scenario: Valid employee login and dashboard access
    Given the employee navigates to the OrangeHRM login page
    When the employee enters valid credentials
    And clicks the login button
    Then the user should be redirected to the dashboard
    And the dashboard should load successfully