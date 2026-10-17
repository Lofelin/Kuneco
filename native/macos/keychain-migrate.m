#import <Foundation/Foundation.h>
#import <Security/Security.h>

static NSString *oldName = @"定途工作空间";
static NSString *newName = @"Kuneco";

static void fail(NSString *stage, OSStatus status) {
  @throw [NSException exceptionWithName:@"MigrationError"
    reason:[NSString stringWithFormat:@"%@ (%d)", stage, (int)status] userInfo:nil];
}

static NSDictionary *readItem(NSString *name, SecKeychainRef keychain) {
  NSMutableDictionary *query = [@{(__bridge id)kSecClass: (__bridge id)kSecClassGenericPassword,
    (__bridge id)kSecAttrService: [name stringByAppendingString:@" Safe Storage"],
    (__bridge id)kSecReturnRef: @YES, (__bridge id)kSecReturnAttributes: @YES,
    (__bridge id)kSecMatchLimit: (__bridge id)kSecMatchLimitAll} mutableCopy];
  if (keychain) query[(__bridge id)kSecMatchSearchList] = @[(__bridge id)keychain];
  CFTypeRef result = NULL;
  OSStatus status = SecItemCopyMatching((__bridge CFDictionaryRef)query, &result);
  if (status == errSecItemNotFound) return nil;
  if (status != errSecSuccess) fail(@"keychain-read", status);
  NSArray *items = CFBridgingRelease(result);
  if (items.count != 1) fail(@"ambiguous-keychain-items", -1);
  NSMutableDictionary *item = [items[0] mutableCopy];
  NSString *account = item[(__bridge id)kSecAttrAccount];
  if (![account isEqualToString:name] && ![account isEqualToString:[name stringByAppendingString:@" Key"]]) fail(@"unexpected-keychain-account", -1);
  UInt32 length = 0; void *bytes = NULL;
  status = SecKeychainItemCopyContent((__bridge SecKeychainItemRef)item[(__bridge id)kSecValueRef], NULL, NULL, &length, &bytes);
  if (status != errSecSuccess) fail(@"keychain-secret-read", status);
  item[(__bridge id)kSecValueData] = [NSData dataWithBytes:bytes length:length];
  SecKeychainItemFreeContent(NULL, bytes);
  if (!length) fail(@"empty-key", -1);
  return item;
}

static void addItem(NSString *name, NSString *account, NSData *secret, NSString *executable, SecKeychainRef keychain) {
  SecTrustedApplicationRef app = NULL, helper = NULL;
  SecAccessRef access = NULL;
  OSStatus status = SecTrustedApplicationCreateFromPath(executable.fileSystemRepresentation, &app);
  if (status != errSecSuccess) fail(@"trusted-app", status);
  status = SecTrustedApplicationCreateFromPath(NULL, &helper);
  if (status != errSecSuccess) { CFRelease(app); fail(@"trusted-helper", status); }
  NSString *service = [name stringByAppendingString:@" Safe Storage"];
  status = SecAccessCreate((__bridge CFStringRef)service, (__bridge CFArrayRef)@[(__bridge id)app, (__bridge id)helper], &access);
  CFRelease(app); CFRelease(helper);
  if (status != errSecSuccess) fail(@"keychain-access", status);
  NSMutableDictionary *attributes = [@{(__bridge id)kSecClass: (__bridge id)kSecClassGenericPassword,
    (__bridge id)kSecAttrService: service, (__bridge id)kSecAttrLabel: service,
    (__bridge id)kSecAttrAccount: account, (__bridge id)kSecValueData: secret,
    (__bridge id)kSecAttrAccess: (__bridge id)access} mutableCopy];
  if (keychain) attributes[(__bridge id)kSecUseKeychain] = (__bridge id)keychain;
  status = SecItemAdd((__bridge CFDictionaryRef)attributes, NULL);
  CFRelease(access);
  // A concurrent creator is only accepted after the same-key readback below.
  if (status != errSecSuccess && status != errSecDuplicateItem) fail(@"keychain-add", status);
}

static NSString *migrate(NSString *executable, SecKeychainRef keychain) {
  NSDictionary *source = readItem(oldName, keychain);
  if (!source) return @"source-missing";
  NSString *account = source[(__bridge id)kSecAttrAccount];
  NSString *targetAccount = [account hasSuffix:@" Key"] ? @"Kuneco Key" : @"Kuneco";
  NSData *secret = source[(__bridge id)kSecValueData];
  NSDictionary *target = readItem(newName, keychain);
  BOOL existed = target != nil;
  if (!target) {
    addItem(newName, targetAccount, secret, executable, keychain);
    target = readItem(newName, keychain);
  }
  if (![target[(__bridge id)kSecAttrAccount] isEqualToString:targetAccount] ||
      ![target[(__bridge id)kSecValueData] isEqualToData:secret]) fail(@"destination-key-conflict", -1);
  // Never rename, delete, or alter the source entry or its ACL.
  return existed ? @"already-migrated" : @"copied";
}

static void selfTest(NSString *directory, NSString *executable) {
  NSString *file = [directory stringByAppendingPathComponent:@"fixture.keychain"];
  unsigned char password[32];
  if (SecRandomCopyBytes(kSecRandomDefault, sizeof(password), password)) fail(@"test-random", -1);
  SecKeychainRef keychain = NULL;
  OSStatus status = SecKeychainCreate(file.fileSystemRepresentation, sizeof(password), password, NO, NULL, &keychain);
  memset(password, 0, sizeof(password));
  if (status != errSecSuccess) fail(@"test-keychain", status);
  @try {
    if (![migrate(executable, keychain) isEqualToString:@"source-missing"]) fail(@"test-missing", -1);
    NSData *secret = [@"synthetic-fixture-key-not-a-real-credential" dataUsingEncoding:NSUTF8StringEncoding];
    addItem(oldName, [oldName stringByAppendingString:@" Key"], secret, executable, keychain);
    if (![migrate(executable, keychain) isEqualToString:@"copied"]) fail(@"test-copy", -1);
    if (![migrate(executable, keychain) isEqualToString:@"already-migrated"]) fail(@"test-idempotent", -1);
    if (![readItem(oldName, keychain)[(__bridge id)kSecValueData] isEqualToData:secret]) fail(@"test-source-preserved", -1);
    NSDictionary *query = @{(__bridge id)kSecClass: (__bridge id)kSecClassGenericPassword,
      (__bridge id)kSecAttrService: @"Kuneco Safe Storage", (__bridge id)kSecMatchSearchList: @[(__bridge id)keychain]};
    status = SecItemUpdate((__bridge CFDictionaryRef)query, (__bridge CFDictionaryRef)@{(__bridge id)kSecValueData: [@"conflicting-fixture-key" dataUsingEncoding:NSUTF8StringEncoding]});
    if (status) fail(@"test-conflict-setup", status);
    BOOL conflict = NO;
    @try { migrate(executable, keychain); } @catch (NSException *error) { conflict = [error.reason hasPrefix:@"destination-key-conflict"]; }
    if (!conflict) fail(@"test-conflict-not-blocked", -1);
    if (![readItem(newName, keychain)[(__bridge id)kSecValueData] isEqualToData:[@"conflicting-fixture-key" dataUsingEncoding:NSUTF8StringEncoding]]) fail(@"test-target-overwritten", -1);
  } @finally { SecKeychainDelete(keychain); CFRelease(keychain); }
}

int main(int argc, const char *argv[]) {
  @autoreleasepool {
    @try {
      NSString *status;
      if (argc == 3 && strcmp(argv[1], "--migrate") == 0) status = migrate(@(argv[2]), NULL);
      else if (argc == 3 && strcmp(argv[1], "--self-test") == 0) { selfTest(@(argv[2]), @(argv[0])); status = @"self-test-passed"; }
      else fail(@"invalid-arguments", -1);
      NSData *json = [NSJSONSerialization dataWithJSONObject:@{@"status": status} options:0 error:nil];
      fwrite(json.bytes, 1, json.length, stdout);
      return 0;
    } @catch (NSException *error) {
      // Only fixed stage names and OSStatus codes; never secret data or attributes.
      fprintf(stderr, "Keychain migration stopped: %s\n", error.reason.UTF8String);
      return 1;
    }
  }
}
