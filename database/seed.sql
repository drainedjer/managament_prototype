-- =============================================================================
-- CasaBatangueño: PostgreSQL Seed Data (Alangilan, Batangas City)
-- Note: Credentials are stored exclusively as bcrypt hashes.
-- =============================================================================

BEGIN;

INSERT INTO users (id, full_name, email, password_hash, role, owner_id, phone, consent_accepted_at) VALUES
(1, 'Lance Caringal', 'owner@casa-bat.com', '$2b$10$kxCW3IHAOqzrwGAJ90fju.EKBC21xkIUCTKPIHjeaPWgTMokeNyIa', 'owner', NULL, '+63 917 555 0101', NOW()),
(2, 'Jeremy Cedrick Rodriguez', 'admin@casa-bat.com', '$2b$10$RwBBLpQx4m7pB9eELupfZuyXO4NIGZ.CT4vLV/m./Mbg1w6aS/.bq', 'admin', NULL, '+63 917 555 0102', NOW()),
(3, 'Christian Jacob Semira', 'staff@casa-bat.com', '$2b$10$xeCKh.bf9Cs2/FHxpM.LBOcuvSTT0wLO8FbZdrl2FQaRubrry/Wnu', 'staff', NULL, '+63 917 555 0103', NOW()),
(4, 'Marco Santos', 'marco.santos@example.edu', '$2b$10$kxCW3IHAOqzrwGAJ90fju.EKBC21xkIUCTKPIHjeaPWgTMokeNyIa', 'customer', NULL, '+63 918 221 4401', NOW())
ON CONFLICT (id) DO NOTHING;

INSERT INTO owners (id, user_id, business_name, tax_id, billing_address) VALUES
(1, 1, 'CasaBatangueño Property Holdings', 'TIN-402-881-990', 'Neptune St., Golden Country Homes, Brgy. Alangilan, Batangas City')
ON CONFLICT (id) DO NOTHING;

UPDATE users SET owner_id = 1 WHERE id IN (1, 3);

INSERT INTO site_settings (key, value) VALUES
('business_name', 'CasaBatangueño'),
('tagline', 'Verified apartments, dormitories, and private rooms in Alangilan, Batangas City'),
('contact_phone', '+63 917 555 0101'),
('contact_email', 'owner@casa-bat.com'),
('office_address', 'Neptune St. (near Alfamart), Golden Country Homes, Brgy. Alangilan, Batangas City'),
('office_hours', 'Monday – Saturday, 8:00 AM – 6:00 PM (Sundays by appointment)')
ON CONFLICT (key) DO NOTHING;

INSERT INTO expense_categories (id, name, description) VALUES
(1, 'Electricity', 'Monthly electric utility charges'),
(2, 'Water', 'Water district billing'),
(3, 'Internet', 'Fiber internet and Wi-Fi routers'),
(4, 'Maintenance', 'Routine preventive maintenance'),
(5, 'Repairs', 'Plumbing, electrical, and fixture repairs'),
(6, 'Cleaning', 'Common area janitorial services'),
(7, 'Supplies', 'Consumables and hardware supplies'),
(8, 'Employee Salary', 'Caretaker and staff payroll'),
(9, 'Taxes', 'Local property and business taxes'),
(10, 'Other Expenses', 'Miscellaneous operational expenses')
ON CONFLICT (id) DO NOTHING;

INSERT INTO amenities (id, name) VALUES
(1, 'High-Speed Fiber Wi-Fi'),
(2, '24/7 CCTV & Keycard Access'),
(3, 'Air Conditioning'),
(4, 'Study Lounge'),
(5, 'Laundry Room'),
(6, 'Shared Kitchen'),
(7, 'Backup Generator'),
(8, 'Bike & Scooter Parking')
ON CONFLICT (id) DO NOTHING;

INSERT INTO properties (
  id, owner_id, name, property_type, address, city, latitude, longitude,
  description, monthly_price, house_rules, is_published, contact_phone, contact_email,
  location_access, nearby_places, landmarks, walking_minutes_bsu, tricycle_minutes_bsu,
  min_lease_months, deposit_policy, utilities_policy, inclusions, curfew_policy
) VALUES
(
  1, 1, 'Neptune St. (near Alfamart)', 'Apartment',
  'Neptune St. (near Alfamart), Golden Country Homes, Alangilan', 'Batangas City',
  13.7851000, 121.0721000,
  'Sunlit mid-rise urban apartments along Neptune Street in Golden Country Homes, right near Alfamart and local eateries in Alangilan. Features private glass balconies, 24/7 security, and fiber-ready study corners.',
  8500.00,
  E'Quiet hours observed from 10:00 PM to 6:00 AM\nNo smoking inside residential units and hallways\nOvernight guests must register at the reception desk',
  TRUE, '+63 917 555 0101', 'owner@casa-bat.com',
  '3 min walk (~250 m) to Jose P. Laurel National Highway & jeepney stops',
  'Alfamart Neptune St. (1 min), Golden Country Homes eateries, BatStateU Alangilan Campus',
  'BatStateU Alangilan Main Gate, Alfamart Neptune St., Golden Country Homes Commercial Strip',
  6, 2, 6,
  '1 month advance + 2 months security deposit (refundable upon move-out inspection; ₱3,000 reservation fee deductible from move-in)',
  'Sub-metered electricity & water (billed monthly); high-speed fiber Wi-Fi & common area upkeep included',
  'Split-type AC, queen/double bedframe with mattress, wardrobe cabinet, study desk & chair, kitchen sink & rangehood',
  'No strict curfew (24/7 keycard access); overnight visitors must register at reception and vacate by 10:00 PM unless approved'
),
(
  2, 1, 'Golden Country Homes, Alangilan', 'Dormitory',
  'Mercury St., Golden Country Homes, Alangilan', 'Batangas City',
  13.7868000, 121.0726000,
  'Purpose-built student dormitory in Golden Country Homes, Alangilan designed with dedicated quiet study lounges, individual oak desks, personal lockers, and biometric gate access near BatStateU Alangilan.',
  2800.00,
  E'Curfew check-in logged after 11:30 PM\nNo heavy cooking appliances inside sleeping rooms\nKeep shared study lounge and pantry clean after use',
  TRUE, '+63 917 555 0101', 'owner@casa-bat.com',
  '4 min walk (~320 m) to Golden Country Homes commercial strip & jeepney route',
  'Mercury St. eateries & printing shops, 7-Eleven & Alfamart, BatStateU Alangilan Engineering Campus',
  'BatStateU Alangilan Campus (4 min walk), 7-Eleven Golden Country Homes, Mercury St. Printing Hubs',
  4, 2, 5,
  '1 month advance + 1 month security deposit (refundable; ₱1,500 reservation fee credited to first month)',
  'Water, common-area electricity & 500 Mbps fiber Wi-Fi included; room AC electricity sub-metered & split evenly per room',
  'Bunk bedframe with foam mattress, individual oak study desk & lamp, lockable steel locker, shared refrigerator & microwave',
  'Gate check-in logged after 11:30 PM; visitors allowed in ground-floor study lounge only from 8:00 AM to 8:00 PM'
),
(
  3, 1, 'Alangilan Proper / National Highway', 'Studio Unit',
  'Jose P. Laurel Hwy, Brgy. Alangilan', 'Batangas City',
  13.7822000, 121.0687000,
  'Fully furnished private studio suites along Jose P. Laurel Highway with warm oak flooring, full-height sunlit windows, ergonomic workspaces, and ensuite bathrooms. Ideal for solo residents seeking quiet focus and easy jeepney access.',
  9500.00,
  E'No pets allowed inside studio suites\nMonthly air-conditioning filter checks scheduled in advance\nObserve building waste segregation schedule',
  TRUE, '+63 917 555 0101', 'owner@casa-bat.com',
  '1 min walk to Jose P. Laurel National Highway jeepney & bus stops',
  'National Highway transit stop, BDO & Metrobank branches, laundry hubs, pharmacies, BatStateU Alangilan',
  'Jose P. Laurel National Highway, BDO Alangilan, Jollibee Alangilan, BatStateU Alangilan',
  8, 3, 6,
  '1 month advance + 2 months security deposit (refundable; ₱3,500 reservation fee credited upon contract signing)',
  'Fiber Wi-Fi & building backup generator included; electricity & water billed per individual unit meter',
  'Inverter AC, queen bed with mattress, ergonomic desk & chair, wardrobe, induction-ready kitchenette & water heater',
  '24/7 keycard access with no curfew; registered guests allowed until 10:00 PM'
),
(
  4, 1, 'South Alangilan / Villa Josefa area', 'Boarding House',
  'Villa Josefa Subdivision, South Alangilan', 'Batangas City',
  13.7805000, 121.0708000,
  'Warm residential boarding house in the Villa Josefa area of South Alangilan offering private rooms and twin-sharing suites around a bright communal kitchen, dining table, and sunlit lounge near local eateries and main transit routes.',
  2500.00,
  E'Shared kitchen clean-as-you-go policy\nQuiet hours start at 10:30 PM on weeknights\nVisitors welcome in common lounge until 9:00 PM',
  TRUE, '+63 917 555 0101', 'owner@casa-bat.com',
  '5 min walk (~400 m) or 2 min tricycle to Jose P. Laurel National Highway',
  'Villa Josefa neighborhood eateries, sari-sari & water refilling stations, South Alangilan tricycle TODA, Jollibee Alangilan',
  'Villa Josefa Gate, Jollibee Alangilan, South Alangilan Tricycle TODA',
  10, 4, 5,
  '1 month advance + 1 month security deposit (refundable; ₱1,000 reservation fee credited to move-in)',
  'Water & fiber Wi-Fi included in monthly rent; room electricity split via sub-meter',
  'Bedframe with mattress, electric fan, study table, clothes rack, access to shared kitchen stove, ref & laundry sink',
  'Quiet hours start at 10:30 PM; main gate locks at 11:00 PM (caretaker key access for late shifts); visitors until 9:00 PM'
),
(
  5, 1, 'Sitio Ibaba, South Alangilan', 'Private Room',
  'Sitio Ibaba, Brgy. Alangilan', 'Batangas City',
  13.7809000, 121.0715000,
  'Quiet private furnished single bedrooms in Sitio Ibaba, Alangilan with built-in bookshelves, natural daylight windows, and quick tricycle or walking access to nearby commercial hubs and BatStateU Alangilan.',
  4500.00,
  E'Single occupancy per private room\nNo loud audio speakers after 10:00 PM\nReport plumbing or electrical issues promptly via portal',
  TRUE, '+63 917 555 0101', 'owner@casa-bat.com',
  '5 min walk (~450 m) or 2 min tricycle to Alangilan commercial hub',
  'Sitio Ibaba eateries, Alangilan barangay hall, convenience stores, National Highway jeepney route',
  'Alangilan Barangay Hall, Sitio Ibaba Tricycle Stop, National Highway',
  9, 3, 6,
  '1 month advance + 1 month security deposit (refundable; ₱1,500 reservation fee deductible on move-in)',
  'Water & high-speed Wi-Fi included; room AC & outlet electricity billed via dedicated sub-meter',
  'Single bed with mattress, AC unit, built-in bookshelf, study desk, swivel chair, private cabinet',
  'No strict curfew for registered tenants; quiet hours 10:00 PM – 6:00 AM; daytime visitors in common area until 8:00 PM'
)
ON CONFLICT (id) DO NOTHING;

INSERT INTO property_amenities (property_id, amenity_id) VALUES
(1,1),(1,2),(1,3),(1,5),(1,7),
(2,1),(2,2),(2,3),(2,4),(2,6),
(3,1),(3,2),(3,3),(3,7),(3,8),
(4,1),(4,4),(4,5),(4,6),(4,8),
(5,1),(5,2),(5,3),(5,4)
ON CONFLICT DO NOTHING;

INSERT INTO property_images (property_id, image_url, is_primary, sort_order) VALUES
(1, '/images/APT-01.png', TRUE, 1),
(1, '/images/Room-01.png', FALSE, 2),
(2, '/images/APT-02.png', TRUE, 1),
(2, '/images/Room-02.png', FALSE, 2),
(3, '/images/APT-03.png', TRUE, 1),
(3, '/images/Room-03.png', FALSE, 2),
(4, '/images/APT-04.png', TRUE, 1),
(4, '/images/Room-04.png', FALSE, 2),
(5, '/images/APT-05.png', TRUE, 1),
(5, '/images/Room-05.png', FALSE, 2)
ON CONFLICT DO NOTHING;

INSERT INTO buildings (id, property_id, name, floors, description) VALUES
(1, 1, 'Neptune St. (near Alfamart)', 3, 'Primary mid-rise apartment wing with balcony units'),
(2, 2, 'Golden Country Homes, Alangilan', 2, 'Student dormitory suites and 2nd-floor study hall'),
(3, 3, 'Alangilan Proper / National Highway', 2, 'Furnished studio suites tower'),
(4, 4, 'South Alangilan / Villa Josefa area', 3, 'Boarding house wing with shared kitchen'),
(5, 5, 'Sitio Ibaba, South Alangilan', 2, 'Quiet single-occupancy rooms')
ON CONFLICT (id) DO NOTHING;

INSERT INTO rooms (id, property_id, building_id, floor_number, room_number, room_type, capacity, occupied_beds, monthly_price, status, description) VALUES
(1, 1, 1, 2, 'A-101', 'Apartment', 2, 1, 8500.00, 'Available', 'Corner 1-bedroom apartment with glass balcony and full kitchen'),
(2, 1, 1, 3, 'A-102', 'Apartment', 2, 0, 8500.00, 'Available', 'Bright 1-bedroom apartment overlooking Neptune street trees'),
(3, 2, 2, 2, 'D-201', 'Dormitory', 4, 2, 2800.00, 'Available', '4-bed student suite with individual study desks, lamps, and lockers'),
(4, 2, 2, 2, 'D-202', 'Dormitory', 4, 4, 2800.00, 'Occupied', '4-bed courtyard-facing dormitory room with ensuite shower'),
(5, 2, 2, 3, 'D-203', 'Private Room', 1, 0, 3000.00, 'Reserved', 'Single occupancy private dorm room near study commons'),
(6, 3, 3, 5, 'S-301', 'Studio Unit', 1, 1, 9500.00, 'Occupied', 'Furnished executive studio with solid oak desk and queen bed'),
(7, 3, 3, 6, 'S-302', 'Studio Unit', 1, 0, 9500.00, 'Reserved', 'High-floor sunlit studio suite with kitchenette and wardrobe'),
(8, 4, 4, 1, 'M-401', 'Shared Room', 2, 1, 2500.00, 'Available', 'Twin-sharing room steps from shared kitchen and dining hall'),
(9, 4, 4, 2, 'M-402', 'Private Room', 1, 0, 3000.00, 'Maintenance', 'Private boarding room currently undergoing AC servicing'),
(10, 5, 5, 2, 'C-501', 'Private Room', 1, 1, 4500.00, 'Occupied', 'Furnished single study room with built-in bookshelf'),
(11, 5, 5, 3, 'C-502', 'Private Room', 1, 0, 4500.00, 'Available', 'Top-floor quiet single room overlooking garden trees')
ON CONFLICT (id) DO NOTHING;

INSERT INTO room_images (room_id, image_url, is_primary, sort_order) VALUES
(1, '/images/Room-01.png', TRUE, 1),
(2, '/images/Room-01.png', TRUE, 1),
(3, '/images/Room-02.png', TRUE, 1),
(4, '/images/Room-02.png', TRUE, 1),
(5, '/images/Room-02.png', TRUE, 1),
(6, '/images/Room-03.png', TRUE, 1),
(7, '/images/Room-03.png', TRUE, 1),
(8, '/images/Room-04.png', TRUE, 1),
(9, '/images/Room-04.png', TRUE, 1),
(10, '/images/Room-05.png', TRUE, 1),
(11, '/images/Room-05.png', TRUE, 1)
ON CONFLICT DO NOTHING;

INSERT INTO tenants (id, user_id, owner_id, full_name, email, contact_number, address, emergency_contact, property_id, room_id, move_in_date, move_out_date, monthly_rent, security_deposit, status) VALUES
(1, 4, 1, 'Marco Santos', 'marco.santos@example.edu', '+63 918 221 4401', 'Poblacion, Batangas City', 'Lorna Santos (+63 917 889 1122)', 1, 1, '2026-06-01', NULL, 8500.00, 17000.00, 'Active'),
(2, NULL, 1, 'Camille Navarro', 'camille.n@example.edu', '+63 917 412 8890', 'Santa Rosa, Laguna', 'Ramon Navarro (+63 918 332 1019)', 2, 3, '2026-07-15', NULL, 2800.00, 2800.00, 'Active'),
(3, NULL, 1, 'Joshua Lim', 'joshua.lim@example.edu', '+63 919 601 7742', 'Imus, Cavite', 'Grace Lim (+63 917 901 3344)', 2, 4, '2026-07-15', NULL, 2800.00, 2800.00, 'Active'),
(4, NULL, 1, 'Bea Alcantara', 'bea.alcantara@example.com', '+63 917 773 9102', 'San Fernando, Pampanga', 'Nestor Alcantara (+63 917 311 4520)', 3, 6, '2026-06-15', NULL, 9500.00, 19000.00, 'Active'),
(5, NULL, 1, 'Daniela Cruz', 'daniela.cruz@example.edu', '+63 920 519 2041', 'Malolos, Bulacan', 'Teresa Cruz (+63 918 441 7788)', 4, 8, '2026-08-01', NULL, 2500.00, 2500.00, 'Active'),
(6, NULL, 1, 'Rafael Soriano', 'rafael.soriano@example.edu', '+63 917 645 9281', 'Antipolo, Rizal', 'Edgar Soriano (+63 917 110 2930)', 5, 10, '2026-08-10', NULL, 4500.00, 4500.00, 'Active'),
(7, NULL, 1, 'Patricia Ocampo', 'patricia.o@example.edu', '+63 918 712 5531', 'Calamba, Laguna', 'Marisol Ocampo (+63 917 884 2210)', 2, 3, '2026-09-01', NULL, 2800.00, 2800.00, 'Active'),
(8, NULL, 1, 'Miguel Velasco', 'miguel.v@example.com', '+63 917 339 1028', 'Pasig City', 'Luis Velasco (+63 917 908 4412)', 1, NULL, '2026-01-15', '2026-07-31', 8500.00, 17000.00, 'Former Tenant')
ON CONFLICT (id) DO NOTHING;

INSERT INTO leases (id, tenant_id, owner_id, property_id, room_id, start_date, end_date, monthly_rate, deposit_amount, status, notes) VALUES
(1, 1, 1, 1, 1, '2026-06-01', '2026-12-20', 8500.00, 17000.00, 'Expiring', '6-month lease ending mid-December; renewal discussion open'),
(2, 2, 1, 2, 3, '2026-07-15', '2027-05-15', 2800.00, 2800.00, 'Active', 'Academic year dormitory contract'),
(3, 3, 1, 2, 4, '2026-07-15', '2027-05-15', 2800.00, 2800.00, 'Active', 'Academic year dormitory contract'),
(4, 4, 1, 3, 6, '2026-06-15', '2026-12-18', 9500.00, 19000.00, 'Expiring', '6-month studio lease up for renewal'),
(5, 5, 1, 4, 8, '2026-08-01', '2027-02-01', 2500.00, 2500.00, 'Active', 'Semester boarding house lease'),
(6, 6, 1, 5, 10, '2026-08-10', '2027-02-10', 4500.00, 4500.00, 'Active', 'Board review 6-month lease'),
(7, 7, 1, 2, 3, '2026-09-01', '2027-06-01', 2800.00, 2800.00, 'Active', 'Academic year dorm slot'),
(8, 8, 1, 1, NULL, '2026-01-15', '2026-07-31', 8500.00, 17000.00, 'Completed', 'Moved out in good standing')
ON CONFLICT (id) DO NOTHING;

INSERT INTO rental_applications (
  id, reference_number, user_id, full_name, email, contact_number,
  property_id, preferred_room_type, assigned_room_id, expected_move_in_date,
  reservation_date, occupants, message, consent_accepted, status
) VALUES
(1, 'APP-2026-1041', NULL, 'Gabriel Torres', 'gabriel.torres@example.edu', '+63 917 802 1190', 2, 'Dormitory', NULL, '2026-12-01', NULL, 1, 'Incoming engineering student looking for a quiet 4-bed dorm slot near BatStateU Alangilan.', TRUE, 'Pending'),
(2, 'APP-2026-1042', NULL, 'Andrea Bautista', 'andrea.b@example.com', '+63 918 991 3402', 3, 'Studio Unit', 7, '2026-12-05', '2026-11-17', 1, 'Product designer seeking a quiet studio unit along Alangilan National Highway.', TRUE, 'Approved'),
(3, 'APP-2026-1043', NULL, 'Hannah Dizon', 'hannah.dizon@example.edu', '+63 917 514 8832', 2, 'Private Room', 5, '2026-12-01', '2026-11-18', 1, 'Reviewing for licensure exam, requesting private dorm room D-203 in Golden Country Homes.', TRUE, 'Reserved'),
(4, 'APP-2026-1044', NULL, 'Nathaniel Gomez', 'nathaniel.g@example.com', '+63 919 205 6611', 1, 'Apartment', NULL, '2026-12-15', NULL, 2, 'Looking for a 1-bedroom balcony unit along Neptune St., Alangilan starting mid-December.', TRUE, 'Pending')
ON CONFLICT (id) DO NOTHING;

INSERT INTO reservations (id, application_id, room_id, beds_held, reserved_date, expires_at, status) VALUES
(1, 2, 7, 1, '2026-11-17', '2026-12-05', 'Active'),
(2, 3, 5, 1, '2026-11-18', '2026-12-01', 'Active')
ON CONFLICT (id) DO NOTHING;

INSERT INTO payments (id, tenant_id, owner_id, property_id, room_id, billing_month, due_date, amount_due, notes) VALUES
(1, 1, 1, 1, 1, '2026-08', '2026-08-05', 8500.00, 'August rent'),
(2, 4, 1, 3, 6, '2026-08', '2026-08-05', 9500.00, 'August rent'),
(3, 1, 1, 1, 1, '2026-09', '2026-09-05', 8500.00, 'September rent'),
(4, 2, 1, 2, 3, '2026-09', '2026-09-05', 2800.00, 'September rent'),
(5, 4, 1, 3, 6, '2026-09', '2026-09-05', 9500.00, 'September rent'),
(6, 1, 1, 1, 1, '2026-10', '2026-10-05', 8500.00, 'October rent'),
(7, 4, 1, 3, 6, '2026-10', '2026-10-05', 9500.00, 'October rent'),
(8, 6, 1, 5, 10, '2026-10', '2026-10-05', 4500.00, 'October rent'),
(9, 1, 1, 1, 1, '2026-11', '2026-11-05', 8500.00, 'November rent'),
(10, 2, 1, 2, 3, '2026-11', '2026-11-05', 2800.00, 'November rent'),
(11, 3, 1, 2, 4, '2026-11', '2026-11-05', 2800.00, 'November rent (partial installment)'),
(12, 4, 1, 3, 6, '2026-11', '2026-11-05', 9500.00, 'November rent'),
(13, 5, 1, 4, 8, '2026-11', '2026-11-05', 2500.00, 'November rent (overdue)'),
(14, 6, 1, 5, 10, '2026-11', '2026-11-18', 4500.00, 'November rent'),
(15, 7, 1, 2, 3, '2026-11', '2026-11-28', 2800.00, 'November rent (upcoming)')
ON CONFLICT (id) DO NOTHING;

INSERT INTO payment_transactions (id, payment_id, amount, payment_date, payment_method, reference_number, receipt_number, notes, recorded_by) VALUES
(1, 1, 8500.00, '2026-08-04', 'Bank Transfer', 'TXN-202608-001', 'RCPT-2026-0001', 'Full settlement', 1),
(2, 2, 9500.00, '2026-08-03', 'Bank Transfer', 'TXN-202608-002', 'RCPT-2026-0002', 'Full settlement', 1),
(3, 3, 8500.00, '2026-09-04', 'Bank Transfer', 'TXN-202609-001', 'RCPT-2026-0003', 'Full settlement', 1),
(4, 4, 2800.00, '2026-09-05', 'GCash', 'TXN-202609-002', 'RCPT-2026-0004', 'Full settlement', 3),
(5, 5, 9500.00, '2026-09-02', 'Bank Transfer', 'TXN-202609-003', 'RCPT-2026-0005', 'Full settlement', 1),
(6, 6, 8500.00, '2026-10-04', 'Bank Transfer', 'TXN-202610-001', 'RCPT-2026-0006', 'Full settlement', 1),
(7, 7, 9500.00, '2026-10-03', 'Bank Transfer', 'TXN-202610-002', 'RCPT-2026-0007', 'Full settlement', 1),
(8, 8, 4500.00, '2026-10-05', 'GCash', 'TXN-202610-003', 'RCPT-2026-0008', 'Full settlement', 3),
(9, 9, 8500.00, '2026-11-03', 'Bank Transfer', 'TXN-202611-001', 'RCPT-2026-0009', 'Full settlement', 1),
(10, 10, 2800.00, '2026-11-04', 'GCash', 'TXN-202611-002', 'RCPT-2026-0010', 'Full settlement', 3),
(11, 11, 1500.00, '2026-11-07', 'Maya', 'TXN-202611-003', 'RCPT-2026-0011', 'First installment via Maya; ₱1,300 balance remaining', 3),
(12, 12, 9500.00, '2026-11-02', 'Bank Transfer', 'TXN-202611-004', 'RCPT-2026-0012', 'Full settlement', 1),
(13, 14, 4500.00, '2026-11-17', 'GCash', 'TXN-202611-006', 'RCPT-2026-0014', 'Full settlement', 3)
ON CONFLICT (id) DO NOTHING;

INSERT INTO expenses (id, owner_id, property_id, category_id, description, amount, expense_date, payment_method, receipt_reference) VALUES
(1, 1, 1, 1, 'Common hallway & security lighting bill (Aug)', 2400.00, '2026-08-12', 'Bank Transfer', 'EXP-2026-0801'),
(2, 1, 2, 3, 'Dual-fiber 500Mbps student Wi-Fi (Sep)', 2000.00, '2026-09-05', 'GCash', 'EXP-2026-0901'),
(3, 1, 3, 8, 'Caretaker monthly allowance (Sep)', 6000.00, '2026-09-30', 'Cash', 'EXP-2026-0902'),
(4, 1, 1, 2, 'Building water utility bill (Oct)', 1500.00, '2026-10-09', 'GCash', 'EXP-2026-1001'),
(5, 1, 3, 8, 'Caretaker monthly allowance (Oct)', 6000.00, '2026-10-30', 'Cash', 'EXP-2026-1002'),
(6, 1, 1, 1, 'Common hallway & security lighting bill (Nov)', 2600.00, '2026-11-06', 'Bank Transfer', 'EXP-2026-1101'),
(7, 1, 2, 3, 'Dual-fiber 500Mbps student Wi-Fi (Nov)', 2000.00, '2026-11-04', 'GCash', 'EXP-2026-1102'),
(8, 1, 3, 8, 'Caretaker & maintenance allowance (Nov)', 6000.00, '2026-11-15', 'Cash', 'EXP-2026-1103'),
(9, 1, 4, 5, 'Room M-402 split-type AC compressor repair', 3200.00, '2026-11-10', 'Cash', 'EXP-2026-1104'),
(10, 1, 5, 6, 'Hallway sanitization & cleaning supplies', 1200.00, '2026-11-18', 'Maya', 'EXP-2026-1105')
ON CONFLICT (id) DO NOTHING;

INSERT INTO reviews (id, property_id, reviewer_name, email, rating, title, comment, status, owner_reply, replied_at, created_at) VALUES
(1, 1, 'Marco Santos', 'marco.santos@example.edu', 5, 'Bright balcony units and reliable fiber internet', 'Living along Neptune St. has been super convenient—Alfamart is literally a minute away and the backup generator kept my online classes running during brownouts.', 'Approved', 'Thank you, Marco! Glad the balcony units and backup power are working well for your studies.', '2026-10-12T10:30:00+08:00', '2026-10-10T14:20:00+08:00'),
(2, 2, 'Camille Navarro', 'camille.n@example.edu', 5, 'Walkable to BatStateU and very quiet study lounge', 'I can walk to Alfamart and BatStateU Alangilan in just a few minutes. The 2nd-floor study lounge and individual lockers make dorm life organized and stress-free.', 'Approved', NULL, NULL, '2026-10-22T09:15:00+08:00'),
(3, 3, 'Bea Alcantara', 'bea.alcantara@example.com', 4, 'Clean furnished studio near the highway', 'The oak workspace and ensuite bathroom are spotless, and catching a jeepney along Jose P. Laurel Highway is effortless. Great option if you work remotely.', 'Approved', 'We appreciate the kind feedback, Bea! Thank you for keeping Studio S-301 in great shape.', '2026-11-03T11:00:00+08:00', '2026-11-02T17:45:00+08:00'),
(4, 4, 'Daniela Cruz', 'daniela.cruz@example.edu', 5, 'Homey atmosphere and budget-friendly rent', 'The shared kitchen saves me so much on food expenses, and the caretaker is quick to help whenever we need anything fixed. Highly recommended for students on a budget.', 'Approved', NULL, NULL, '2026-11-08T13:10:00+08:00'),
(5, 5, 'Rafael Soriano', 'rafael.soriano@example.edu', 4, 'Peaceful single room for board review', 'Very quiet neighborhood in Sitio Ibaba with good natural light and strong AC. Easy tricycle ride straight to the highway whenever it rains.', 'Approved', NULL, NULL, '2026-11-15T16:05:00+08:00'),
(6, 2, 'Joshua Lim', 'joshua.lim@example.edu', 4, 'Safe biometric gate and responsive staff', 'Biometric entry and CCTV give my parents peace of mind. Wi-Fi speed is consistently fast even in the evenings when everyone is online.', 'Pending', NULL, NULL, '2026-11-20T08:40:00+08:00')
ON CONFLICT (id) DO NOTHING;

INSERT INTO testimonials (id, property_id, author_name, role_label, rating, quote, status) VALUES
(1, 2, 'Camille Navarro', 'BS Civil Engineering · BatStateU Alangilan', 5, 'Walking 4 minutes to campus and having a quiet study lounge with backup fiber made finals week so much easier.', 'Approved'),
(2, 1, 'Marco Santos', 'BS Mechanical Engineering · BatStateU', 5, 'Transparent utility sub-meters and digital receipts every month. No guesswork or surprise charges.', 'Approved'),
(3, 3, 'Bea Alcantara', 'Remote Product Designer', 5, 'Super accessible along Jose P. Laurel Highway with peaceful work-from-home setup and fast caretaker support.', 'Approved')
ON CONFLICT (id) DO NOTHING;

INSERT INTO contact_messages (id, full_name, email, phone, subject, message, consent_accepted, status, created_at) VALUES
(1, 'Clarisse Mendoza', 'clarisse.m@example.edu', '+63 917 612 9901', 'Ocular visit inquiry for Golden Country Homes Dorm', 'Good day! My daughter is relocating to Alangilan, Batangas City next month. May we schedule a room viewing this Saturday at 10:00 AM?', TRUE, 'New', '2026-11-22T09:10:00+08:00')
ON CONFLICT (id) DO NOTHING;

INSERT INTO viewing_requests (id, property_id, full_name, email, phone, preferred_date, preferred_time, notes, consent_accepted, status) VALUES
(1, 2, 'Clarisse Mendoza', 'clarisse.m@example.edu', '+63 917 612 9901', '2026-11-28', '10:00 AM', 'Would like to inspect 4-bed dorm room D-201 with my daughter.', TRUE, 'Pending')
ON CONFLICT (id) DO NOTHING;

INSERT INTO maintenance_requests (id, owner_id, property_id, room_id, tenant_id, user_id, title, description, priority, status, owner_notes) VALUES
(1, 1, 1, 1, 1, 4, 'Balcony screen door latch adjustment', 'The sliding screen latch on A-101 feels slightly loose and sticks when closing.', 'Low', 'In Progress', 'Caretaker scheduled for Friday afternoon.')
ON CONFLICT (id) DO NOTHING;

INSERT INTO announcements (id, owner_id, property_id, title, body, is_published) VALUES
(1, 1, NULL, 'December Water Tank Preventive Cleaning', 'Scheduled water tank flushing across all Alangilan buildings on December 3 from 1:00 PM to 3:00 PM. Please store drinking water beforehand.', TRUE),
(2, 1, 2, 'Finals Week Extended Study Lounge Hours', 'The Golden Country Homes Dormitory 2nd-floor study lounge AC and coffee station will stay open 24/7 during finals week.', TRUE)
ON CONFLICT (id) DO NOTHING;

INSERT INTO notifications (id, user_id, title, body, link, is_read) VALUES
(1, 1, 'New rental application APP-2026-1044', 'Nathaniel Gomez applied for Neptune St. (near Alfamart).', 'applications', FALSE),
(2, 1, 'Lease expiring within 30 days', 'Marco Santos (Room A-101) lease ends on 2026-12-20.', 'tenants', FALSE)
ON CONFLICT (id) DO NOTHING;

-- Sync identity sequences after explicit ID inserts
SELECT setval(pg_get_serial_sequence('users', 'id'), COALESCE((SELECT MAX(id) FROM users), 1));
SELECT setval(pg_get_serial_sequence('owners', 'id'), COALESCE((SELECT MAX(id) FROM owners), 1));
SELECT setval(pg_get_serial_sequence('expense_categories', 'id'), COALESCE((SELECT MAX(id) FROM expense_categories), 1));
SELECT setval(pg_get_serial_sequence('amenities', 'id'), COALESCE((SELECT MAX(id) FROM amenities), 1));
SELECT setval(pg_get_serial_sequence('properties', 'id'), COALESCE((SELECT MAX(id) FROM properties), 1));
SELECT setval(pg_get_serial_sequence('property_images', 'id'), COALESCE((SELECT MAX(id) FROM property_images), 1));
SELECT setval(pg_get_serial_sequence('buildings', 'id'), COALESCE((SELECT MAX(id) FROM buildings), 1));
SELECT setval(pg_get_serial_sequence('rooms', 'id'), COALESCE((SELECT MAX(id) FROM rooms), 1));
SELECT setval(pg_get_serial_sequence('room_images', 'id'), COALESCE((SELECT MAX(id) FROM room_images), 1));
SELECT setval(pg_get_serial_sequence('tenants', 'id'), COALESCE((SELECT MAX(id) FROM tenants), 1));
SELECT setval(pg_get_serial_sequence('leases', 'id'), COALESCE((SELECT MAX(id) FROM leases), 1));
SELECT setval(pg_get_serial_sequence('rental_applications', 'id'), COALESCE((SELECT MAX(id) FROM rental_applications), 1));
SELECT setval(pg_get_serial_sequence('reservations', 'id'), COALESCE((SELECT MAX(id) FROM reservations), 1));
SELECT setval(pg_get_serial_sequence('payments', 'id'), COALESCE((SELECT MAX(id) FROM payments), 1));
SELECT setval(pg_get_serial_sequence('payment_transactions', 'id'), COALESCE((SELECT MAX(id) FROM payment_transactions), 1));
SELECT setval(pg_get_serial_sequence('expenses', 'id'), COALESCE((SELECT MAX(id) FROM expenses), 1));
SELECT setval(pg_get_serial_sequence('reviews', 'id'), COALESCE((SELECT MAX(id) FROM reviews), 1));
SELECT setval(pg_get_serial_sequence('testimonials', 'id'), COALESCE((SELECT MAX(id) FROM testimonials), 1));
SELECT setval(pg_get_serial_sequence('contact_messages', 'id'), COALESCE((SELECT MAX(id) FROM contact_messages), 1));
SELECT setval(pg_get_serial_sequence('viewing_requests', 'id'), COALESCE((SELECT MAX(id) FROM viewing_requests), 1));
SELECT setval(pg_get_serial_sequence('maintenance_requests', 'id'), COALESCE((SELECT MAX(id) FROM maintenance_requests), 1));
SELECT setval(pg_get_serial_sequence('announcements', 'id'), COALESCE((SELECT MAX(id) FROM announcements), 1));
SELECT setval(pg_get_serial_sequence('notifications', 'id'), COALESCE((SELECT MAX(id) FROM notifications), 1));

COMMIT;
