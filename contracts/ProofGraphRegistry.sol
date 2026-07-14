// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

contract ProofGraphRegistry {
    struct Profile {
        address wallet;
        bytes32 discordHash;
        bytes32 xHash;
        string handle;
        uint256 score;
        uint64 createdAt;
        uint64 updatedAt;
        bool active;
    }

    struct ProofReceipt {
        bytes32 proofType;
        bytes32 proofHash;
        uint16 points;
        string evidenceUri;
        address attestor;
        uint64 createdAt;
    }

    address public owner;
    mapping(address => bool) public attestors;
    mapping(address => Profile) private profiles;
    mapping(address => ProofReceipt[]) private receipts;
    mapping(address => mapping(bytes32 => bool)) public proofUsed;
    address[] private builders;

    event OwnerTransferred(address indexed previousOwner, address indexed nextOwner);
    event AttestorSet(address indexed attestor, bool trusted);
    event ProfileRegistered(address indexed builder, bytes32 discordHash, bytes32 xHash, string handle);
    event ProofReviewRequested(address indexed builder, bytes32 indexed proofType, bytes32 indexed proofHash, string evidenceUri);
    event ProofRecorded(address indexed builder, bytes32 indexed proofType, bytes32 indexed proofHash, uint16 points, address attestor);
    event ProfileDeactivated(address indexed builder);

    error NotOwner();
    error NotAttestor();
    error InvalidInput();
    error MissingProfile();
    error DuplicateProof();

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    modifier onlyAttestor() {
        if (!attestors[msg.sender]) revert NotAttestor();
        _;
    }

    constructor(address initialAttestor) {
        owner = msg.sender;
        attestors[msg.sender] = true;
        if (initialAttestor != address(0)) attestors[initialAttestor] = true;
        emit OwnerTransferred(address(0), msg.sender);
        emit AttestorSet(msg.sender, true);
        if (initialAttestor != address(0) && initialAttestor != msg.sender) emit AttestorSet(initialAttestor, true);
    }

    function transferOwnership(address nextOwner) external onlyOwner {
        if (nextOwner == address(0)) revert InvalidInput();
        address previousOwner = owner;
        owner = nextOwner;
        emit OwnerTransferred(previousOwner, nextOwner);
    }

    function setAttestor(address attestor, bool trusted) external onlyOwner {
        if (attestor == address(0)) revert InvalidInput();
        attestors[attestor] = trusted;
        emit AttestorSet(attestor, trusted);
    }

    function registerProfile(bytes32 discordHash, bytes32 xHash, string calldata handle) external {
        if (bytes(handle).length == 0) revert InvalidInput();

        Profile storage profile = profiles[msg.sender];
        if (profile.wallet == address(0)) {
            builders.push(msg.sender);
            profile.wallet = msg.sender;
            profile.createdAt = uint64(block.timestamp);
            profile.active = true;
        }

        profile.discordHash = discordHash;
        profile.xHash = xHash;
        profile.handle = handle;
        profile.updatedAt = uint64(block.timestamp);

        emit ProfileRegistered(msg.sender, discordHash, xHash, handle);
    }

    function requestProofReview(bytes32 proofType, bytes32 proofHash, string calldata evidenceUri) external {
        if (profiles[msg.sender].wallet == address(0)) revert MissingProfile();
        if (proofType == bytes32(0) || proofHash == bytes32(0) || bytes(evidenceUri).length == 0) revert InvalidInput();
        emit ProofReviewRequested(msg.sender, proofType, proofHash, evidenceUri);
    }

    function recordProof(
        address builder,
        bytes32 proofType,
        bytes32 proofHash,
        uint16 points,
        string calldata evidenceUri
    ) external onlyAttestor {
        Profile storage profile = profiles[builder];
        if (profile.wallet == address(0) || !profile.active) revert MissingProfile();
        if (proofType == bytes32(0) || proofHash == bytes32(0) || points == 0 || bytes(evidenceUri).length == 0) revert InvalidInput();
        if (proofUsed[builder][proofHash]) revert DuplicateProof();

        proofUsed[builder][proofHash] = true;
        profile.score += points;
        profile.updatedAt = uint64(block.timestamp);
        receipts[builder].push(
            ProofReceipt({
                proofType: proofType,
                proofHash: proofHash,
                points: points,
                evidenceUri: evidenceUri,
                attestor: msg.sender,
                createdAt: uint64(block.timestamp)
            })
        );

        emit ProofRecorded(builder, proofType, proofHash, points, msg.sender);
    }

    function deactivateProfile(address builder) external onlyOwner {
        if (profiles[builder].wallet == address(0)) revert MissingProfile();
        profiles[builder].active = false;
        profiles[builder].updatedAt = uint64(block.timestamp);
        emit ProfileDeactivated(builder);
    }

    function getProfile(address builder) external view returns (Profile memory) {
        return profiles[builder];
    }

    function getReceipts(address builder) external view returns (ProofReceipt[] memory) {
        return receipts[builder];
    }

    function getBuilderCount() external view returns (uint256) {
        return builders.length;
    }

    function getBuilderAt(uint256 index) external view returns (address) {
        return builders[index];
    }

    function getLeaderboardPage(uint256 offset, uint256 limit) external view returns (Profile[] memory page) {
        if (limit == 0) return new Profile[](0);

        uint256 activeCount = 0;
        for (uint256 index = 0; index < builders.length; index++) {
            Profile storage profile = profiles[builders[index]];
            if (profile.active) activeCount++;
        }

        if (offset >= activeCount) return new Profile[](0);

        Profile[] memory ranked = new Profile[](activeCount);
        uint256 cursor = 0;
        for (uint256 index = 0; index < builders.length; index++) {
            Profile storage profile = profiles[builders[index]];
            if (profile.active) {
                ranked[cursor] = profile;
                cursor++;
            }
        }

        for (uint256 i = 0; i < ranked.length; i++) {
            uint256 best = i;
            for (uint256 j = i + 1; j < ranked.length; j++) {
                if (_ranksHigher(ranked[j], ranked[best])) best = j;
            }
            if (best != i) {
                Profile memory temp = ranked[i];
                ranked[i] = ranked[best];
                ranked[best] = temp;
            }
        }

        uint256 remaining = activeCount - offset;
        uint256 pageSize = limit < remaining ? limit : remaining;
        page = new Profile[](pageSize);
        for (uint256 index = 0; index < pageSize; index++) {
            page[index] = ranked[offset + index];
        }
    }

    function _ranksHigher(Profile memory left, Profile memory right) private pure returns (bool) {
        if (left.score != right.score) return left.score > right.score;
        if (left.updatedAt != right.updatedAt) return left.updatedAt < right.updatedAt;
        return left.wallet < right.wallet;
    }
}
