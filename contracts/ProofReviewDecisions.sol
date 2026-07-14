// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IProofGraphRegistry {
    function proofUsed(address builder, bytes32 proofHash) external view returns (bool);

    function recordProof(
        address builder,
        bytes32 proofType,
        bytes32 proofHash,
        uint16 points,
        string calldata evidenceUri
    ) external;
}

contract ProofReviewDecisions {
    enum Decision {
        None,
        Accepted,
        Rejected
    }

    address public owner;
    IProofGraphRegistry public immutable registry;
    mapping(address => bool) public attestors;
    mapping(address => mapping(bytes32 => Decision)) public decisions;

    event OwnerTransferred(address indexed previousOwner, address indexed nextOwner);
    event AttestorSet(address indexed attestor, bool trusted);
    event ProofAccepted(
        address indexed builder,
        bytes32 indexed proofType,
        bytes32 indexed proofHash,
        uint16 points,
        address attestor
    );
    event ProofRejected(
        address indexed builder,
        bytes32 indexed proofType,
        bytes32 indexed proofHash,
        string reason,
        address attestor
    );

    error NotOwner();
    error NotAttestor();
    error InvalidInput();
    error AlreadyDecided();

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    modifier onlyAttestor() {
        if (!attestors[msg.sender]) revert NotAttestor();
        _;
    }

    constructor(address registryAddress, address initialAttestor) {
        if (registryAddress == address(0)) revert InvalidInput();
        owner = msg.sender;
        registry = IProofGraphRegistry(registryAddress);
        attestors[msg.sender] = true;
        if (initialAttestor != address(0)) attestors[initialAttestor] = true;
        emit OwnerTransferred(address(0), msg.sender);
        emit AttestorSet(msg.sender, true);
        if (initialAttestor != address(0) && initialAttestor != msg.sender) {
            emit AttestorSet(initialAttestor, true);
        }
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

    function rejectProof(
        address builder,
        bytes32 proofType,
        bytes32 proofHash,
        string calldata reason
    ) external onlyAttestor {
        bytes memory reasonBytes = bytes(reason);
        if (
            builder == address(0) ||
            proofType == bytes32(0) ||
            proofHash == bytes32(0) ||
            reasonBytes.length == 0 ||
            reasonBytes.length > 280
        ) revert InvalidInput();
        if (decisions[builder][proofHash] != Decision.None || registry.proofUsed(builder, proofHash)) {
            revert AlreadyDecided();
        }

        decisions[builder][proofHash] = Decision.Rejected;
        emit ProofRejected(builder, proofType, proofHash, reason, msg.sender);
    }

    function approveProof(
        address builder,
        bytes32 proofType,
        bytes32 proofHash,
        uint16 points,
        string calldata evidenceUri
    ) external onlyAttestor {
        if (
            builder == address(0) ||
            proofType == bytes32(0) ||
            proofHash == bytes32(0) ||
            points == 0 ||
            bytes(evidenceUri).length == 0
        ) revert InvalidInput();
        if (decisions[builder][proofHash] != Decision.None || registry.proofUsed(builder, proofHash)) {
            revert AlreadyDecided();
        }

        decisions[builder][proofHash] = Decision.Accepted;
        registry.recordProof(builder, proofType, proofHash, points, evidenceUri);
        emit ProofAccepted(builder, proofType, proofHash, points, msg.sender);
    }
}
