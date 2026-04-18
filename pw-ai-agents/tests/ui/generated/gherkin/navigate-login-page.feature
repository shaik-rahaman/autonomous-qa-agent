Feature: User Login
  Scenario: Successful user login
    Given the user is on the login page
    When the user enters username "admin"
    And the user enters password "admin123"
    And the user clicks the login button
    Then the dashboard should be displayed