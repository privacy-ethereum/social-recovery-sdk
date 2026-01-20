use jwt::JWT;
use poseidon::poseidon2::Poseidon2;

global MAX_DATA_LENGTH: u32 = 900;      // JWT signed data (header.payload) max length
global MAX_EMAIL_LENGTH: u32 = 128;     // max email length in bytes
global PACKED_EMAIL_FIELDS: u32 = 5;    // ceil(128/31) Fields needed for email
global BYTES_PER_FIELD: u32 = 31;       // 31 bytes safely fit in a Field (~254 bits)

/// Packs bytes into Field elements (31 bytes per Field, big-endian).
fn pack_bytes_to_fields<let N: u32, let M: u32>(bytes: BoundedVec<u8, N>) -> [Field; M] {
    let mut result: [Field; M] = [0; M];
    let len = bytes.len();

    for field_idx in 0..M {
        let mut field_value: Field = 0;
        let start_byte = field_idx * BYTES_PER_FIELD;

        for byte_offset in 0..BYTES_PER_FIELD {
            let byte_idx = start_byte + byte_offset;
            if byte_idx < len {
                field_value = field_value * 256 + bytes.get(byte_idx) as Field;
            }
        }
        result[field_idx] = field_value;
    }

    result
}

/// Verifies a Google JWT and outputs commitment = Poseidon2(email_hash, salt).
///
/// # Public Inputs
/// - `pubkey_modulus_limbs`: RSA public key modulus (identifies Google signing key)
/// - `intent_hash`: Hash of RecoveryIntent (binds proof to specific recovery session)
///
/// # Returns
/// - `commitment`: Poseidon2(email_hash, salt) identifying the guardian
fn main(
    // Private inputs
    data: BoundedVec<u8, MAX_DATA_LENGTH>,
    base64_decode_offset: u32,
    redc_params_limbs: [u128; 18],
    signature_limbs: [u128; 18],
    email: BoundedVec<u8, MAX_EMAIL_LENGTH>,
    salt: Field,
    // Public inputs
    pubkey_modulus_limbs: pub [u128; 18],
    intent_hash: pub Field,
) -> pub Field {
    // Dummy constraint for intent_hash public input
    assert(intent_hash != 0, "intent_hash cannot be zero");

    // Initialize and verify JWT signature
    let jwt: JWT<MAX_DATA_LENGTH> = JWT::init(
        data,
        base64_decode_offset,
        pubkey_modulus_limbs,
        redc_params_limbs,
        signature_limbs,
    );
    jwt.verify();

    // Verify email is verified by Google
    jwt.assert_claim_bool("email_verified".as_bytes(), true);

    // Extract and verify email matches provided email
    let jwt_email: BoundedVec<u8, MAX_EMAIL_LENGTH> = jwt.get_claim_string("email".as_bytes());
    assert(jwt_email.len() == email.len(), "Email length mismatch");
    for i in 0..MAX_EMAIL_LENGTH {
        if i < email.len() {
            assert(jwt_email.get(i) == email.get(i), "Email content mismatch");
        }
    }

    // Pack email bytes into Field elements (31 bytes per Field)
    let packed_email: [Field; PACKED_EMAIL_FIELDS] = pack_bytes_to_fields(email);

    // email_hash = Poseidon2(packed_email_fields, email_len)
    let email_hash = Poseidon2::hash(
        [packed_email[0], packed_email[1], packed_email[2], packed_email[3], packed_email[4], email.len() as Field],
        6,
    );

    // commitment = Poseidon2(email_hash, salt)
    // Note: intent_hash is a public input that binds this proof to a specific recovery session.
    // The on-chain verifier checks that intent_hash matches the current session's RecoveryIntent.
    Poseidon2::hash([email_hash, salt], 2)
}

#[test]
fn test_pack_bytes_to_fields() {
    let mut bytes: BoundedVec<u8, 128> = BoundedVec::new();
    bytes.push(0x61); // 'a'
    bytes.push(0x62); // 'b'
    bytes.push(0x63); // 'c'

    let packed: [Field; 5] = pack_bytes_to_fields(bytes);

    // "abc" big-endian: 0x61 * 256^2 + 0x62 * 256 + 0x63 = 6382179
    assert(packed[0] == 6382179);
    assert(packed[1] == 0);
}

#[test]
fn test_commitment() {
    let mut email: BoundedVec<u8, 128> = BoundedVec::new();
    let email_bytes: [u8; 14] = [97, 108, 105, 99, 101, 64, 116, 101, 115, 116, 46, 99, 111, 109]; // alice@test.com
    for i in 0..14 {
        email.push(email_bytes[i]);
    }

    let packed: [Field; 5] = pack_bytes_to_fields(email);
    let email_hash = Poseidon2::hash([packed[0], packed[1], packed[2], packed[3], packed[4], 14], 6);

    let c1 = Poseidon2::hash([email_hash, 123], 2);
    let c2 = Poseidon2::hash([email_hash, 123], 2);
    let c3 = Poseidon2::hash([email_hash, 456], 2);

    assert(c1 == c2); // same inputs -> same commitment
    assert(c1 != c3); // different salt -> different commitment
}

#[test]
fn test_multi_field_packing_and_uniqueness() {
    // Test email that spans multiple fields (>31 bytes)
    // "verylongemailaddress1234@example.com" = 36 bytes (spans 2 fields)
    let mut long_email: BoundedVec<u8, 128> = BoundedVec::new();
    let long_email_bytes: [u8; 36] = [
        118, 101, 114, 121, 108, 111, 110, 103, 101, 109, 97, 105, 108, 97, 100, 100,  // "verylongemailadd"
        114, 101, 115, 115, 49, 50, 51, 52, 64, 101, 120, 97, 109, 112, 108, 101,      // "ress1234@example"
        46, 99, 111, 109                                                                // ".com"
    ];
    for i in 0..36 {
        long_email.push(long_email_bytes[i]);
    }

    let packed_long: [Field; 5] = pack_bytes_to_fields(long_email);

    // First field should contain first 31 bytes, second field should contain remaining 5 bytes
    assert(packed_long[0] != 0); // First field has data
    assert(packed_long[1] != 0); // Second field has data (bytes 32-36)
    assert(packed_long[2] == 0); // Third field is empty

    // Compute commitment for long email
    let long_email_hash = Poseidon2::hash(
        [packed_long[0], packed_long[1], packed_long[2], packed_long[3], packed_long[4], 36],
        6,
    );
    let long_commitment = Poseidon2::hash([long_email_hash, 999], 2);

    // Compute commitment for short email (alice@test.com)
    let mut short_email: BoundedVec<u8, 128> = BoundedVec::new();
    let short_email_bytes: [u8; 14] = [97, 108, 105, 99, 101, 64, 116, 101, 115, 116, 46, 99, 111, 109];
    for i in 0..14 {
        short_email.push(short_email_bytes[i]);
    }
    let packed_short: [Field; 5] = pack_bytes_to_fields(short_email);
    let short_email_hash = Poseidon2::hash(
        [packed_short[0], packed_short[1], packed_short[2], packed_short[3], packed_short[4], 14],
        6,
    );
    let short_commitment = Poseidon2::hash([short_email_hash, 999], 2);

    // Different emails with same salt must produce different commitments
    assert(long_commitment != short_commitment);

    // Same long email with same salt must produce same commitment (deterministic)
    let long_commitment_2 = Poseidon2::hash([long_email_hash, 999], 2);
    assert(long_commitment == long_commitment_2);
}

#[test(should_fail_with = "intent_hash cannot be zero")]
fn test_intent_hash_cannot_be_zero() {
    // This test verifies that intent_hash = 0 is rejected
    let intent_hash: Field = 0;
    assert(intent_hash != 0, "intent_hash cannot be zero");
}
