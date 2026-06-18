Feature: User Login
  Scenario: Successful user login
    Given the user navigates to the login page
    When the user enters username and password
    And clicks the login button
    Then the home page appears