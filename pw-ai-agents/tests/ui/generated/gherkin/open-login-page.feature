Feature: Student Login
  Scenario: Successful student login
    Given the user opens the login page
    When the user enters the username "student"
    And the user enters the password "Password123"
    And clicks the login button
    Then the user should see the message "Congratulations student. You successfully logged in"