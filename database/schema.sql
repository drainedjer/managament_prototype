-- =============================================================================
-- HavenStay: Apartment & Dormitory Rental Management System
-- MySQL 8.0 / MariaDB Relational Database Schema (XAMPP / phpMyAdmin Ready)
-- =============================================================================

CREATE DATABASE IF NOT EXISTS rental_management_db
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;

USE rental_management_db;

-- 1. Users (RBAC Authentication)
CREATE TABLE IF NOT EXISTS users (
  id INT AUTO_INCREMENT PRIMARY KEY,
  full_name VARCHAR(120) NOT NULL,
  email VARCHAR(150) NOT NULL UNIQUE,
  password_hash VARCHAR(255) NOT NULL,
  role ENUM('admin', 'owner', 'staff') NOT NULL DEFAULT 'owner',
  phone VARCHAR(30) DEFAULT '',
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_users_role (role)
) ENGINE=InnoDB;

-- 2. Owners
CREATE TABLE IF NOT EXISTS owners (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL UNIQUE,
  business_name VARCHAR(150) NOT NULL,
  tax_id VARCHAR(60) DEFAULT NULL,
  billing_address VARCHAR(255) DEFAULT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_owners_user FOREIGN KEY (user_id) REFERENCES users(id)
    ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB;

-- 3. Properties
CREATE TABLE IF NOT EXISTS properties (
  id INT AUTO_INCREMENT PRIMARY KEY,
  owner_id INT NOT NULL,
  name VARCHAR(150) NOT NULL,
  property_type ENUM('Apartment', 'Dormitory', 'Boarding House', 'Studio Unit', 'Shared Room', 'Private Room') NOT NULL,
  address VARCHAR(255) NOT NULL,
  city VARCHAR(100) NOT NULL,
  latitude DECIMAL(10, 7) NOT NULL,
  longitude DECIMAL(10, 7) NOT NULL,
  description TEXT NOT NULL,
  monthly_price DECIMAL(12, 2) NOT NULL,
  house_rules TEXT,
  is_published TINYINT(1) NOT NULL DEFAULT 1,
  contact_phone VARCHAR(30) NOT NULL,
  contact_email VARCHAR(150) NOT NULL,
  location_access VARCHAR(255) DEFAULT NULL,
  nearby_places TEXT DEFAULT NULL,
  deposit_policy TEXT DEFAULT NULL,
  utilities_policy TEXT DEFAULT NULL,
  inclusions TEXT DEFAULT NULL,
  curfew_policy TEXT DEFAULT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_properties_owner FOREIGN KEY (owner_id) REFERENCES owners(id)
    ON DELETE CASCADE ON UPDATE CASCADE,
  INDEX idx_properties_city (city),
  INDEX idx_properties_type (property_type),
  INDEX idx_properties_published (is_published)
) ENGINE=InnoDB;

-- 4. Buildings
CREATE TABLE IF NOT EXISTS buildings (
  id INT AUTO_INCREMENT PRIMARY KEY,
  property_id INT NOT NULL,
  name VARCHAR(120) NOT NULL,
  floors INT NOT NULL DEFAULT 1,
  description VARCHAR(255) DEFAULT '',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_buildings_property FOREIGN KEY (property_id) REFERENCES properties(id)
    ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB;

-- 5. Rooms
CREATE TABLE IF NOT EXISTS rooms (
  id INT AUTO_INCREMENT PRIMARY KEY,
  property_id INT NOT NULL,
  building_id INT NOT NULL,
  floor_number INT NOT NULL DEFAULT 1,
  room_number VARCHAR(30) NOT NULL,
  room_type ENUM('Apartment', 'Dormitory', 'Boarding House', 'Studio Unit', 'Shared Room', 'Private Room') NOT NULL,
  capacity INT NOT NULL DEFAULT 1,
  occupied_beds INT NOT NULL DEFAULT 0,
  monthly_price DECIMAL(12, 2) NOT NULL,
  status ENUM('Available', 'Occupied', 'Reserved', 'Maintenance') NOT NULL DEFAULT 'Available',
  description TEXT,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_building_room (building_id, room_number),
  CONSTRAINT fk_rooms_property FOREIGN KEY (property_id) REFERENCES properties(id)
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_rooms_building FOREIGN KEY (building_id) REFERENCES buildings(id)
    ON DELETE CASCADE ON UPDATE CASCADE,
  INDEX idx_rooms_status (status)
) ENGINE=InnoDB;

-- 6. Tenants
CREATE TABLE IF NOT EXISTS tenants (
  id INT AUTO_INCREMENT PRIMARY KEY,
  full_name VARCHAR(120) NOT NULL,
  email VARCHAR(150) NOT NULL,
  contact_number VARCHAR(30) NOT NULL,
  address VARCHAR(255) NOT NULL,
  emergency_contact VARCHAR(150) NOT NULL,
  property_id INT NOT NULL,
  room_id INT DEFAULT NULL,
  move_in_date DATE NOT NULL,
  move_out_date DATE DEFAULT NULL,
  monthly_rent DECIMAL(12, 2) NOT NULL,
  security_deposit DECIMAL(12, 2) NOT NULL DEFAULT 0.00,
  status ENUM('Active', 'Pending', 'Inactive', 'Former Tenant') NOT NULL DEFAULT 'Active',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_tenants_property FOREIGN KEY (property_id) REFERENCES properties(id)
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT fk_tenants_room FOREIGN KEY (room_id) REFERENCES rooms(id)
    ON DELETE SET NULL ON UPDATE CASCADE,
  INDEX idx_tenants_status (status),
  INDEX idx_tenants_name (full_name)
) ENGINE=InnoDB;

-- 7. Rental Contracts
CREATE TABLE IF NOT EXISTS rental_contracts (
  id INT AUTO_INCREMENT PRIMARY KEY,
  tenant_id INT NOT NULL,
  room_id INT NOT NULL,
  start_date DATE NOT NULL,
  end_date DATE DEFAULT NULL,
  monthly_rate DECIMAL(12, 2) NOT NULL,
  deposit_amount DECIMAL(12, 2) NOT NULL,
  contract_status ENUM('Active', 'Completed', 'Terminated') NOT NULL DEFAULT 'Active',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_contracts_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id)
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_contracts_room FOREIGN KEY (room_id) REFERENCES rooms(id)
    ON DELETE RESTRICT ON UPDATE CASCADE
) ENGINE=InnoDB;

-- 8. Rental Applications
CREATE TABLE IF NOT EXISTS rental_applications (
  id INT AUTO_INCREMENT PRIMARY KEY,
  reference_number VARCHAR(40) NOT NULL UNIQUE,
  full_name VARCHAR(120) NOT NULL,
  email VARCHAR(150) NOT NULL,
  contact_number VARCHAR(30) NOT NULL,
  property_id INT NOT NULL,
  preferred_room_type ENUM('Apartment', 'Dormitory', 'Boarding House', 'Studio Unit', 'Shared Room', 'Private Room') NOT NULL,
  assigned_room_id INT DEFAULT NULL,
  expected_move_in_date DATE NOT NULL,
  reservation_date DATE DEFAULT NULL,
  occupants INT NOT NULL DEFAULT 1,
  message TEXT,
  status ENUM('Pending', 'Approved', 'Rejected', 'Reserved', 'Completed', 'Cancelled') NOT NULL DEFAULT 'Pending',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_applications_property FOREIGN KEY (property_id) REFERENCES properties(id)
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_applications_room FOREIGN KEY (assigned_room_id) REFERENCES rooms(id)
    ON DELETE SET NULL ON UPDATE CASCADE,
  INDEX idx_applications_status (status)
) ENGINE=InnoDB;

-- 9. Reservations
CREATE TABLE IF NOT EXISTS reservations (
  id INT AUTO_INCREMENT PRIMARY KEY,
  application_id INT NOT NULL,
  room_id INT NOT NULL,
  reserved_date DATE NOT NULL,
  expires_at DATE NOT NULL,
  status ENUM('Active', 'Converted', 'Cancelled', 'Expired') NOT NULL DEFAULT 'Active',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_reservations_app FOREIGN KEY (application_id) REFERENCES rental_applications(id)
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_reservations_room FOREIGN KEY (room_id) REFERENCES rooms(id)
    ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB;

-- 10. Payments
CREATE TABLE IF NOT EXISTS payments (
  id INT AUTO_INCREMENT PRIMARY KEY,
  tenant_id INT NOT NULL,
  property_id INT NOT NULL,
  room_id INT DEFAULT NULL,
  billing_month CHAR(7) NOT NULL,
  due_date DATE NOT NULL,
  payment_date DATE DEFAULT NULL,
  amount_due DECIMAL(12, 2) NOT NULL,
  amount_paid DECIMAL(12, 2) NOT NULL DEFAULT 0.00,
  remaining_balance DECIMAL(12, 2) NOT NULL DEFAULT 0.00,
  payment_method ENUM('Cash', 'GCash', 'Maya', 'Bank Transfer', 'Other') NOT NULL DEFAULT 'Cash',
  status ENUM('Paid', 'Partial', 'Pending', 'Overdue') NOT NULL DEFAULT 'Pending',
  reference_number VARCHAR(80) NOT NULL UNIQUE,
  receipt_number VARCHAR(80) NOT NULL UNIQUE,
  notes VARCHAR(255) DEFAULT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_payments_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id)
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_payments_property FOREIGN KEY (property_id) REFERENCES properties(id)
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT fk_payments_room FOREIGN KEY (room_id) REFERENCES rooms(id)
    ON DELETE SET NULL ON UPDATE CASCADE,
  INDEX idx_payments_status (status),
  INDEX idx_payments_month (billing_month)
) ENGINE=InnoDB;

-- 11. Expense Categories
CREATE TABLE IF NOT EXISTS expense_categories (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(80) NOT NULL UNIQUE,
  description VARCHAR(255) DEFAULT ''
) ENGINE=InnoDB;

-- 12. Expenses
CREATE TABLE IF NOT EXISTS expenses (
  id INT AUTO_INCREMENT PRIMARY KEY,
  property_id INT NOT NULL,
  category_id INT NOT NULL,
  description VARCHAR(255) NOT NULL,
  amount DECIMAL(12, 2) NOT NULL,
  expense_date DATE NOT NULL,
  payment_method ENUM('Cash', 'GCash', 'Maya', 'Bank Transfer', 'Other') NOT NULL DEFAULT 'Bank Transfer',
  receipt_reference VARCHAR(100) NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_expenses_property FOREIGN KEY (property_id) REFERENCES properties(id)
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_expenses_category FOREIGN KEY (category_id) REFERENCES expense_categories(id)
    ON DELETE RESTRICT ON UPDATE CASCADE,
  INDEX idx_expenses_date (expense_date)
) ENGINE=InnoDB;

-- 13. Amenities
CREATE TABLE IF NOT EXISTS amenities (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(80) NOT NULL UNIQUE
) ENGINE=InnoDB;

-- 14. Property Amenities (Join Table)
CREATE TABLE IF NOT EXISTS property_amenities (
  property_id INT NOT NULL,
  amenity_id INT NOT NULL,
  PRIMARY KEY (property_id, amenity_id),
  CONSTRAINT fk_pa_property FOREIGN KEY (property_id) REFERENCES properties(id)
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_pa_amenity FOREIGN KEY (amenity_id) REFERENCES amenities(id)
    ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB;

-- 15. Property Images
CREATE TABLE IF NOT EXISTS property_images (
  id INT AUTO_INCREMENT PRIMARY KEY,
  property_id INT NOT NULL,
  image_url VARCHAR(500) NOT NULL,
  is_primary TINYINT(1) NOT NULL DEFAULT 0,
  CONSTRAINT fk_pi_property FOREIGN KEY (property_id) REFERENCES properties(id)
    ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB;

-- 16. Room Images
CREATE TABLE IF NOT EXISTS room_images (
  id INT AUTO_INCREMENT PRIMARY KEY,
  room_id INT NOT NULL,
  image_url VARCHAR(500) NOT NULL,
  CONSTRAINT fk_ri_room FOREIGN KEY (room_id) REFERENCES rooms(id)
    ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB;

-- 17. Payment Receipts
CREATE TABLE IF NOT EXISTS payment_receipts (
  id INT AUTO_INCREMENT PRIMARY KEY,
  payment_id INT NOT NULL UNIQUE,
  receipt_number VARCHAR(80) NOT NULL UNIQUE,
  issued_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  issued_by INT DEFAULT NULL,
  CONSTRAINT fk_receipts_payment FOREIGN KEY (payment_id) REFERENCES payments(id)
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_receipts_user FOREIGN KEY (issued_by) REFERENCES users(id)
    ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB;

-- 18. Notifications
CREATE TABLE IF NOT EXISTS notifications (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL,
  title VARCHAR(150) NOT NULL,
  body VARCHAR(255) NOT NULL,
  is_read TINYINT(1) NOT NULL DEFAULT 0,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_notifications_user FOREIGN KEY (user_id) REFERENCES users(id)
    ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB;

-- 19. Audit Logs
CREATE TABLE IF NOT EXISTS audit_logs (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT DEFAULT NULL,
  action VARCHAR(100) NOT NULL,
  entity_type VARCHAR(60) NOT NULL,
  entity_id INT DEFAULT NULL,
  details TEXT,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_audit_user FOREIGN KEY (user_id) REFERENCES users(id)
    ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB;

-- 20. Property Reviews
CREATE TABLE IF NOT EXISTS reviews (
  id INT AUTO_INCREMENT PRIMARY KEY,
  property_id INT NOT NULL,
  reviewer_name VARCHAR(120) NOT NULL,
  email VARCHAR(150) NOT NULL,
  rating TINYINT NOT NULL,
  title VARCHAR(150) DEFAULT '',
  comment TEXT NOT NULL,
  status ENUM('Pending', 'Approved', 'Rejected') NOT NULL DEFAULT 'Pending',
  owner_reply TEXT DEFAULT NULL,
  replied_at DATETIME DEFAULT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT chk_reviews_rating CHECK (rating BETWEEN 1 AND 5),
  CONSTRAINT fk_reviews_property FOREIGN KEY (property_id) REFERENCES properties(id)
    ON DELETE CASCADE ON UPDATE CASCADE,
  UNIQUE KEY uq_review_property_email (property_id, email),
  INDEX idx_reviews_property_status (property_id, status)
) ENGINE=InnoDB;

-- 21. Contact Messages
CREATE TABLE IF NOT EXISTS contact_messages (
  id INT AUTO_INCREMENT PRIMARY KEY,
  full_name VARCHAR(120) NOT NULL,
  email VARCHAR(150) NOT NULL,
  phone VARCHAR(30) DEFAULT '',
  subject VARCHAR(150) DEFAULT '',
  message TEXT NOT NULL,
  status ENUM('New', 'Read', 'Replied') NOT NULL DEFAULT 'New',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB;

