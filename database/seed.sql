-- =============================================================================
-- HavenStay: Sample Seed Data for rental_management_db
-- Demo passwords (bcrypt hashed):
--   owner@casa-bat.com / Owner123!
--   admin@casa-bat.com / Admin123!
--   staff@casa-bat.com / Staff123!
-- =============================================================================

USE rental_management_db;

INSERT INTO users (id, full_name, email, password_hash, role, phone) VALUES
(1, 'Lance Caringal', 'owner@casa-bat.com', '$2b$10$kxCW3IHAOqzrwGAJ90fju.EKBC21xkIUCTKPIHjeaPWgTMokeNyIa', 'owner', '+63 917 555 0101'),
(2, 'Jeremy Cedrick Rodriguez', 'admin@casa-bat.com', '$2b$10$RwBBLpQx4m7pB9eELupfZuyXO4NIGZ.CT4vLV/m./Mbg1w6aS/.bq', 'admin', '+63 917 555 0102'),
(3, 'Christian Jacob Semira', 'staff@casa-bat.com', '$2b$10$xeCKh.bf9Cs2/FHxpM.LBOcuvSTT0wLO8FbZdrl2FQaRubrry/Wnu', 'staff', '+63 917 555 0103');

INSERT INTO owners (id, user_id, business_name, tax_id, billing_address) VALUES
(1, 1, 'HavenStay Property Holdings', 'TIN-402-881-990', 'Alangilan, Batangas City');

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
(10, 'Other Expenses', 'Miscellaneous operational expenses');

INSERT INTO amenities (id, name) VALUES
(1, 'High-Speed Fiber Wi-Fi'),
(2, '24/7 CCTV & Keycard Access'),
(3, 'Air Conditioning'),
(4, 'Study Lounge'),
(5, 'Laundry Room'),
(6, 'Shared Kitchen'),
(7, 'Backup Generator'),
(8, 'Bike & Scooter Parking');

INSERT INTO properties (id, owner_id, name, property_type, address, city, latitude, longitude, description, monthly_price, house_rules, is_published, contact_phone, contact_email, location_access, nearby_places, deposit_policy, utilities_policy, inclusions, curfew_policy) VALUES
(1, 1, 'Neptune St. (near Alfamart)', 'Apartment', 'Neptune St. (near Alfamart), Golden Country Homes, Alangilan', 'Batangas City', 13.7851000, 121.0721000, 'Sunlit mid-rise urban apartments along Neptune Street in Golden Country Homes, right near Alfamart and local eateries in Alangilan. Features private glass balconies, 24/7 concierge security, and fiber-ready study corners.', 8500.00, 'Quiet hours observed from 10:00 PM to 6:00 AM|No smoking inside residential units and hallways|Overnight guests must register at the reception desk', 1, '+63 917 555 0101', 'owner@casa-bat.com', '3 min walk (~250 m) to Jose P. Laurel National Highway & jeepney stops', 'Alfamart Neptune St. (1 min), carinderias & coffee shops along Golden Country Homes, Batangas City–Alangilan jeepney & tricycle terminal', '1 month advance + 2 months security deposit (refundable upon move-out inspection; ₱3,000 reservation fee deductible from move-in)', 'Sub-metered electricity & water (billed monthly); high-speed fiber Wi-Fi & common area upkeep included', 'Split-type AC, queen/double bedframe with mattress, wardrobe cabinet, study desk & chair, kitchen sink & rangehood', 'No strict curfew (24/7 keycard access); overnight visitors must register at reception and vacate by 10:00 PM unless approved'),
(2, 1, 'Golden Country Homes, Alangilan', 'Dormitory', 'Mercury St., Golden Country Homes, Alangilan', 'Batangas City', 13.7868000, 121.0726000, 'Purpose-built dormitory in Golden Country Homes, Alangilan designed with dedicated quiet study lounges, individual oak desks, personal lockers, and biometric gate access.', 2800.00, 'Curfew check-in logged after 11:30 PM|No heavy cooking appliances inside sleeping rooms|Keep shared study lounge and pantry clean after use', 1, '+63 917 555 0101', 'owner@casa-bat.com', '4 min walk (~320 m) to Golden Country Homes commercial strip & jeepney route', 'Mercury St. eateries & printing shops, 7-Eleven & Alfamart, jeepney stop on Jose P. Laurel Hwy', '1 month advance + 1 month security deposit (refundable; ₱1,500 reservation fee credited to first month)', 'Water, common-area electricity & 500 Mbps fiber Wi-Fi included; room AC electricity sub-metered & split evenly per room', 'Bunk bedframe with foam mattress, individual oak study desk & lamp, lockable steel locker, shared refrigerator & microwave', 'Gate check-in logged after 11:30 PM; visitors allowed in ground-floor study lounge only from 8:00 AM to 8:00 PM'),
(3, 1, 'Alangilan Proper / National Highway', 'Studio Unit', 'Jose P. Laurel Hwy, Brgy. Alangilan', 'Batangas City', 13.7822000, 121.0687000, 'Fully furnished private studio suites along Jose P. Laurel Highway with warm oak flooring, full-height sunlit windows, ergonomic workspaces, and ensuite bathrooms. Ideal for solo residents seeking quiet focus and easy jeepney access across Batangas City.', 9500.00, 'No pets allowed inside studio suites|Monthly air-conditioning filter checks scheduled in advance|Observe building waste segregation schedule', 1, '+63 917 555 0101', 'owner@casa-bat.com', '1 min walk to Jose P. Laurel National Highway jeepney & bus stops', 'Jose P. Laurel National Highway transit stop, BDO & Metrobank branches, laundry hubs, fast-food & pharmacies', '1 month advance + 2 months security deposit (refundable; ₱3,500 reservation fee credited upon contract signing)', 'Fiber Wi-Fi & building backup generator included; electricity & water billed per individual unit meter', 'Inverter AC, queen bed with mattress, ergonomic desk & chair, wardrobe, induction-ready kitchenette & water heater', '24/7 keycard access with no curfew; registered guests allowed until 10:00 PM'),
(4, 1, 'South Alangilan / Villa Josefa area', 'Boarding House', 'South Alangilan / Villa Josefa area', 'Batangas City', 13.7805000, 121.0708000, 'Warm residential boarding house in the Villa Josefa area of South Alangilan offering private rooms and twin-sharing suites around a bright communal kitchen, dining table, and sunlit lounge near local eateries and main transit routes.', 2500.00, 'Shared kitchen clean-as-you-go policy|Quiet hours start at 10:30 PM on weeknights|Visitors welcome in common lounge until 9:00 PM', 1, '+63 917 555 0101', 'owner@casa-bat.com', '5 min walk (~400 m) or 2 min tricycle to Jose P. Laurel National Highway', 'Villa Josefa neighborhood eateries, sari-sari & water refilling stations, South Alangilan tricycle TODA, Jollibee Alangilan', '1 month advance + 1 month security deposit (refundable; ₱1,000 reservation fee credited to move-in)', 'Water & fiber Wi-Fi included in monthly rent; room electricity split via sub-meter', 'Bedframe with mattress, electric fan, study table, clothes rack, access to shared kitchen stove, ref & laundry sink', 'Quiet hours start at 10:30 PM; main gate locks at 11:00 PM (caretaker key access for late shifts); visitors until 9:00 PM'),
(5, 1, 'Sitio Ibaba, South Alangilan', 'Private Room', 'Sitio Ibaba, Brgy. Alangilan', 'Batangas City', 13.7805000, 121.0715000, 'Quiet private furnished single bedrooms in Sitio Ibaba, Alangilan with built-in bookshelves, natural daylight windows, and quick tricycle or walking access to nearby commercial hubs.', 4500.00, 'Single occupancy per private room|No loud audio speakers after 10:00 PM|Report plumbing or electrical issues promptly via portal', 1, '+63 917 555 0101', 'owner@casa-bat.com', '5 min walk (~450 m) or 2 min tricycle to Alangilan commercial hub', 'Sitio Ibaba eateries, Alangilan barangay hall, convenience stores, National Highway jeepney route (5 min walk)', '1 month advance + 1 month security deposit (refundable; ₱1,500 reservation fee deductible on move-in)', 'Water & high-speed Wi-Fi included; room AC & outlet electricity billed via dedicated sub-meter', 'Single bed with mattress, AC unit, built-in bookshelf, study desk, swivel chair, private cabinet', 'No strict curfew for registered tenants; quiet hours 10:00 PM – 6:00 AM; daytime visitors in common area until 8:00 PM');

INSERT INTO buildings (id, property_id, name, floors, description) VALUES
(1, 1, 'Neptune St. (near Alfamart)', 3, 'Primary mid-rise apartment wing with balcony units'),
(2, 2, 'Golden Country Homes, Alangilan', 2, 'Student dormitory suites and 2nd-floor study hall'),
(3, 3, 'Alangilan Proper / National Highway', 2, 'Furnished studio suites tower'),
(4, 4, 'South Alangilan / Villa Josefa area', 3, 'Boarding house wing with shared kitchen'),
(5, 5, 'Sitio Ibaba, South Alangilan', 2, 'Quiet single-occupancy rooms');

INSERT INTO rooms (id, property_id, building_id, floor_number, room_number, room_type, capacity, occupied_beds, monthly_price, status, description) VALUES
(1, 1, 1, 2, 'A-101', 'Apartment', 2, 2, 8500.00, 'Occupied', 'Corner 1-bedroom apartment with glass balcony and full kitchen'),
(2, 1, 1, 3, 'A-102', 'Apartment', 2, 0, 8500.00, 'Available', 'Bright 1-bedroom apartment overlooking street trees'),
(3, 2, 2, 2, 'D-201', 'Dormitory', 4, 2, 2800.00, 'Available', '4-bed student suite with individual study desks, lamps, and lockers'),
(4, 2, 2, 2, 'D-202', 'Dormitory', 4, 4, 2800.00, 'Occupied', '4-bed courtyard-facing dormitory room with ensuite shower'),
(5, 2, 2, 3, 'D-203', 'Private Room', 1, 0, 3000.00, 'Reserved', 'Single occupancy private dorm room near study commons'),
(6, 3, 3, 5, 'S-301', 'Studio Unit', 1, 1, 9500.00, 'Occupied', 'Furnished executive studio with solid oak desk and queen bed'),
(7, 3, 3, 6, 'S-302', 'Studio Unit', 1, 0, 9500.00, 'Available', 'High-floor sunlit studio suite with kitchenette and wardrobe'),
(8, 4, 4, 1, 'M-401', 'Shared Room', 2, 1, 2500.00, 'Available', 'Twin-sharing room steps from shared kitchen and dining hall'),
(9, 4, 4, 2, 'M-402', 'Private Room', 1, 0, 3000.00, 'Maintenance', 'Private boarding room currently undergoing AC servicing'),
(10, 5, 5, 2, 'C-501', 'Private Room', 1, 1, 4500.00, 'Occupied', 'Furnished single study room with built-in bookshelf'),
(11, 5, 5, 3, 'C-502', 'Private Room', 1, 0, 4500.00, 'Available', 'Top-floor quiet single room overlooking garden trees');

INSERT INTO tenants (id, full_name, email, contact_number, address, emergency_contact, property_id, room_id, move_in_date, move_out_date, monthly_rent, security_deposit, status) VALUES
(1, 'Marco Santos', 'marco.santos@example.edu', '+63 918 221 4401', 'Poblacion, Batangas City', 'Lorna Santos (+63 917 889 1122)', 1, 1, '2026-06-01', NULL, 8500.00, 37000.00, 'Active'),
(2, 'Camille Navarro', 'camille.n@example.edu', '+63 917 412 8890', 'Santa Rosa, Laguna', 'Ramon Navarro (+63 918 332 1019)', 2, 3, '2026-07-15', NULL, 2800.00, 6500.00, 'Active'),
(3, 'Joshua Lim', 'joshua.lim@example.edu', '+63 919 601 7742', 'Imus, Cavite', 'Grace Lim (+63 917 901 3344)', 2, 4, '2026-07-15', NULL, 2800.00, 6500.00, 'Active'),
(4, 'Bea Alcantara', 'bea.alcantara@example.com', '+63 917 773 9102', 'San Fernando, Pampanga', 'Nestor Alcantara (+63 917 311 4520)', 3, 6, '2026-06-15', NULL, 9500.00, 44000.00, 'Active'),
(5, 'Daniela Cruz', 'daniela.cruz@example.edu', '+63 920 519 2041', 'Malolos, Bulacan', 'Teresa Cruz (+63 918 441 7788)', 4, 8, '2026-08-01', NULL, 2500.00, 5800.00, 'Active'),
(6, 'Rafael Soriano', 'rafael.soriano@example.edu', '+63 917 645 9281', 'Antipolo, Rizal', 'Edgar Soriano (+63 917 110 2930)', 5, 10, '2026-08-10', NULL, 4500.00, 19000.00, 'Active'),
(7, 'Patricia Ocampo', 'patricia.o@example.edu', '+63 918 712 5531', 'Calamba, Laguna', 'Marisol Ocampo (+63 917 884 2210)', 2, 3, '2026-09-01', NULL, 2800.00, 6500.00, 'Active'),
(8, 'Miguel Velasco', 'miguel.v@example.com', '+63 917 339 1028', 'Pasig City', 'Luis Velasco (+63 917 908 4412)', 1, NULL, '2026-01-15', '2026-07-31', 8500.00, 37000.00, 'Former Tenant');

INSERT INTO rental_applications (id, reference_number, full_name, email, contact_number, property_id, preferred_room_type, assigned_room_id, expected_move_in_date, reservation_date, occupants, message, status) VALUES
(1, 'APP-2026-1041', 'Gabriel Torres', 'gabriel.torres@example.edu', '+63 917 802 1190', 2, 'Dormitory', NULL, '2026-12-01', NULL, 1, 'Looking for a quiet 4-bed dorm slot in Golden Country Homes, Alangilan.', 'Pending'),
(2, 'APP-2026-1042', 'Andrea Bautista', 'andrea.b@example.com', '+63 918 991 3402', 3, 'Studio Unit', 7, '2026-12-05', '2026-11-17', 1, 'Product designer seeking a quiet studio unit along Alangilan Highway.', 'Approved'),
(3, 'APP-2026-1043', 'Hannah Dizon', 'hannah.dizon@example.edu', '+63 917 514 8832', 2, 'Private Room', 5, '2026-12-01', '2026-11-18', 1, 'Reviewing for licensure exam, requesting private dorm room D-203.', 'Reserved'),
(4, 'APP-2026-1044', 'Nathaniel Gomez', 'nathaniel.g@example.com', '+63 919 205 6611', 1, 'Apartment', NULL, '2026-12-15', NULL, 2, 'Looking for a 1-bedroom balcony unit starting mid-December.', 'Pending');

INSERT INTO payments (id, tenant_id, property_id, room_id, billing_month, due_date, payment_date, amount_due, amount_paid, remaining_balance, payment_method, status, reference_number, receipt_number) VALUES
(1, 1, 1, 1, '2026-08', '2026-08-05', '2026-08-04', 8500.00, 8500.00, 0.00, 'Bank Transfer', 'Paid', 'TXN-202608-001', 'RCPT-2026-0001'),
(2, 4, 3, 6, '2026-08', '2026-08-05', '2026-08-03', 9500.00, 9500.00, 0.00, 'Bank Transfer', 'Paid', 'TXN-202608-002', 'RCPT-2026-0002'),
(3, 1, 1, 1, '2026-09', '2026-09-05', '2026-09-04', 8500.00, 8500.00, 0.00, 'Bank Transfer', 'Paid', 'TXN-202609-001', 'RCPT-2026-0003'),
(4, 2, 2, 3, '2026-09', '2026-09-05', '2026-09-05', 2800.00, 2800.00, 0.00, 'GCash', 'Paid', 'TXN-202609-002', 'RCPT-2026-0004'),
(5, 4, 3, 6, '2026-09', '2026-09-05', '2026-09-02', 9500.00, 9500.00, 0.00, 'Bank Transfer', 'Paid', 'TXN-202609-003', 'RCPT-2026-0005'),
(6, 1, 1, 1, '2026-10', '2026-10-05', '2026-10-04', 8500.00, 8500.00, 0.00, 'Bank Transfer', 'Paid', 'TXN-202610-001', 'RCPT-2026-0006'),
(7, 4, 3, 6, '2026-10', '2026-10-05', '2026-10-03', 9500.00, 9500.00, 0.00, 'Bank Transfer', 'Paid', 'TXN-202610-002', 'RCPT-2026-0007'),
(8, 6, 5, 10, '2026-10', '2026-10-05', '2026-10-05', 4500.00, 4500.00, 0.00, 'GCash', 'Paid', 'TXN-202610-003', 'RCPT-2026-0008'),
(9, 1, 1, 1, '2026-11', '2026-11-05', '2026-11-03', 8500.00, 8500.00, 0.00, 'Bank Transfer', 'Paid', 'TXN-202611-001', 'RCPT-2026-0009'),
(10, 2, 2, 3, '2026-11', '2026-11-05', '2026-11-04', 2800.00, 2800.00, 0.00, 'GCash', 'Paid', 'TXN-202611-002', 'RCPT-2026-0010'),
(11, 3, 2, 4, '2026-11', '2026-11-05', '2026-11-07', 2800.00, 1500.00, 1300.00, 'Maya', 'Partial', 'TXN-202611-003', 'RCPT-2026-0011'),
(12, 4, 3, 6, '2026-11', '2026-11-05', '2026-11-02', 9500.00, 9500.00, 0.00, 'Bank Transfer', 'Paid', 'TXN-202611-004', 'RCPT-2026-0012'),
(13, 5, 4, 8, '2026-11', '2026-11-05', NULL, 2500.00, 0.00, 2500.00, 'Cash', 'Overdue', 'TXN-202611-005', 'RCPT-2026-0013'),
(14, 6, 5, 10, '2026-11', '2026-11-18', '2026-11-17', 4500.00, 4500.00, 0.00, 'GCash', 'Paid', 'TXN-202611-006', 'RCPT-2026-0014'),
(15, 7, 2, 3, '2026-11', '2026-11-25', NULL, 2800.00, 0.00, 2800.00, 'Cash', 'Pending', 'TXN-202611-007', 'RCPT-2026-0015');

INSERT INTO expenses (id, property_id, category_id, description, amount, expense_date, payment_method, receipt_reference) VALUES
(1, 1, 1, 'Common hallway & elevator Meralco bill (Aug)', 5800.00, '2026-08-12', 'Bank Transfer', 'EXP-2026-0801'),
(2, 2, 3, 'Dual-fiber 500Mbps student Wi-Fi (Sep)', 4500.00, '2026-09-05', 'GCash', 'EXP-2026-0901'),
(3, 3, 8, 'Front desk & caretaker monthly payroll (Sep)', 14000.00, '2026-09-30', 'Bank Transfer', 'EXP-2026-0902'),
(4, 1, 2, 'Manila Water bulk building meter (Oct)', 3900.00, '2026-10-09', 'Bank Transfer', 'EXP-2026-1001'),
(5, 3, 8, 'Front desk & caretaker monthly payroll (Oct)', 14000.00, '2026-10-30', 'Bank Transfer', 'EXP-2026-1002'),
(6, 1, 1, 'Common hallway & security lighting bill (Nov)', 6400.00, '2026-11-06', 'Bank Transfer', 'EXP-2026-1101'),
(7, 2, 3, 'Dual-fiber 500Mbps student Wi-Fi (Nov)', 4500.00, '2026-11-04', 'GCash', 'EXP-2026-1102'),
(8, 3, 8, 'Building receptionist & maintenance payroll (Nov)', 14000.00, '2026-11-15', 'Bank Transfer', 'EXP-2026-1103'),
(9, 4, 5, 'Room M-402 split-type AC compressor repair', 3200.00, '2026-11-10', 'Cash', 'EXP-2026-1104'),
(10, 5, 6, 'Deep sanitization & hallway cleaning supplies', 2400.00, '2026-11-18', 'Maya', 'EXP-2026-1105');

INSERT INTO reviews (id, property_id, reviewer_name, email, rating, title, comment, status, owner_reply, replied_at, created_at) VALUES
(1, 1, 'Marco Santos', 'marco.santos@example.edu', 5, 'Bright balcony units and reliable fiber internet', 'Living along Neptune St. has been super convenient—Alfamart is literally a minute away and the backup generator kept my online classes running during brownouts.', 'Approved', 'Thank you, Marco! Glad the balcony units and backup power are working well for your studies.', '2026-10-12 10:30:00', '2026-10-10 14:20:00'),
(2, 2, 'Camille Navarro', 'camille.n@example.edu', 5, 'Walkable to shops and very quiet study lounge', 'I can walk to Alfamart and the highway jeepney stop in under five minutes. The 2nd-floor study lounge and individual lockers make dorm life organized and stress-free.', 'Approved', NULL, NULL, '2026-10-22 09:15:00'),
(3, 3, 'Bea Alcantara', 'bea.alcantara@example.com', 4, 'Clean furnished studio near the highway', 'The oak workspace and ensuite bathroom are spotless, and catching a jeepney along Jose P. Laurel Highway is effortless. Great option if you work remotely.', 'Approved', 'We appreciate the kind feedback, Bea! Thank you for keeping Studio S-301 in great shape.', '2026-11-03 11:00:00', '2026-11-02 17:45:00'),
(4, 4, 'Daniela Cruz', 'daniela.cruz@example.edu', 5, 'Homey atmosphere and budget-friendly rent', 'The shared kitchen saves me so much on food expenses, and the caretaker is quick to help whenever we need anything fixed. Highly recommended for students on a budget.', 'Approved', NULL, NULL, '2026-11-08 13:10:00'),
(5, 5, 'Rafael Soriano', 'rafael.soriano@example.edu', 4, 'Peaceful single room for board review', 'Very quiet neighborhood in Sitio Ibaba with good natural light and strong AC. Easy tricycle ride straight to the highway whenever it rains.', 'Approved', NULL, NULL, '2026-11-15 16:05:00'),
(6, 2, 'Joshua Lim', 'joshua.lim@example.edu', 4, 'Safe biometric gate and responsive staff', 'Biometric entry and CCTV give my parents peace of mind. Wi-Fi speed is consistently fast even in the evenings when everyone is online.', 'Pending', NULL, NULL, '2026-11-20 08:40:00');

INSERT INTO contact_messages (id, full_name, email, phone, subject, message, status, created_at) VALUES
(1, 'Clarisse Mendoza', 'clarisse.m@example.edu', '+63 917 612 9901', 'Ocular visit inquiry for Golden Country Homes Dorm', 'Good day! My daughter is relocating to Alangilan, Batangas City next month. May we schedule a room viewing this Saturday at 10:00 AM?', 'New', '2026-11-22 09:10:00');

